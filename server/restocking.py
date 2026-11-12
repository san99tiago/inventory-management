"""
Restocking rules for the Factory Inventory Management System.

2026-11-12: Pure functions only (no FastAPI, no global state) so the ranking,
budget and pricing rules can be tested in isolation. main.py owns the in-memory
submitted_orders list and the lock that protects it.
"""
import logging
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# 2026-11-12: Prices for WDG-001, BRG-102, GSK-203, MTR-304, FLT-405, VLV-506
# and PSU-501 come from generate_data.py and inventory.json. SNR-420 and
# CTL-330 have no reference price in the repo, and every supplier name and
# lead time below is an assumption. Replace them when real supplier data exists.
RESTOCK_CATALOG: Dict[str, Dict] = {
    "WDG-001": {"name": "Industrial Widget Type A", "unit_cost": 24.99, "supplier_name": "Acme Components", "lead_time_days": 14},
    "BRG-102": {"name": "Steel Bearing Assembly", "unit_cost": 89.50, "supplier_name": "Precision Bearings Co", "lead_time_days": 21},
    "GSK-203": {"name": "High-Temperature Gasket", "unit_cost": 12.75, "supplier_name": "SealTech Supply", "lead_time_days": 10},
    "MTR-304": {"name": "Electric Motor 5HP", "unit_cost": 445.00, "supplier_name": "Motion Dynamics", "lead_time_days": 30},
    "FLT-405": {"name": "Oil Filter Cartridge", "unit_cost": 8.25, "supplier_name": "CleanFlow Industrial", "lead_time_days": 7},
    "VLV-506": {"name": "Pressure Relief Valve", "unit_cost": 156.00, "supplier_name": "FluidControl Ltd", "lead_time_days": 21},
    "PSU-501": {"name": "5V 10A Switching Power Supply", "unit_cost": 18.99, "supplier_name": "PowerGrid Supply", "lead_time_days": 14},
    "SNR-420": {"name": "Temperature Sensor Module", "unit_cost": 34.50, "supplier_name": "SenseTech", "lead_time_days": 18},
    "CTL-330": {"name": "Logic Controller Board", "unit_cost": 62.00, "supplier_name": "CtrlLogic", "lead_time_days": 12},
}

# 2026-11-12: Lower rank = buy first. Unknown trends sort after "decreasing".
TREND_RANK = {"increasing": 0, "stable": 1, "decreasing": 2}
UNKNOWN_TREND_RANK = 3


def to_cents(amount: float) -> int:
    """Convert a dollar amount to integer cents.

    2026-11-12: Money is summed in integer cents because float sums drift
    (0.1 + 0.2 != 0.3). A drift could let an order slip past the budget.
    """
    return int(round(amount * 100))


def budget_to_cents(budget: float) -> int:
    """Round a budget DOWN to whole cents so the user never overspends.

    2026-11-12: round(x, 6) first removes float noise. Without it,
    0.29 * 100 == 28.999999999999996 and floor would give 28 cents.
    """
    return math.floor(round(budget * 100, 6))


def growth_fraction(current: int, forecast: int) -> float:
    """Forecast growth relative to current demand (0.5 means +50%).

    2026-11-12: current_demand can be 0. Growth from 0 to a positive forecast
    is treated as infinite so it ranks first within its trend. This avoids a
    division by zero.
    """
    if current == 0:
        return math.inf if forecast > 0 else 0.0
    return (forecast - current) / current


def rank_forecasts(forecasts: List[dict]) -> List[dict]:
    """Return forecasts in buying priority order. The input list is not changed.

    2026-11-12: Order is trend first, then growth descending, then SKU ascending.
    The SKU tie-break makes the order deterministic.
    """
    def sort_key(forecast: dict):
        trend_rank = TREND_RANK.get(forecast.get("trend", ""), UNKNOWN_TREND_RANK)
        growth = growth_fraction(forecast["current_demand"], forecast["forecasted_demand"])
        return (trend_rank, -growth, forecast["item_sku"])

    return sorted(forecasts, key=sort_key)


def _growth_pct(current: int, forecast: int) -> Optional[float]:
    """Growth as a percentage for display. None when growth is infinite (JSON cannot hold inf)."""
    growth = growth_fraction(current, forecast)
    return None if math.isinf(growth) else round(growth * 100, 2)


def build_recommendations(forecasts: List[dict], budget: float) -> dict:
    """Pick forecast items to restock within a budget.

    2026-11-12: Greedy by priority. Each item is funded for its full forecasted
    quantity if it fits the remaining budget. If it does not fit, the item is
    skipped and the loop continues, because a cheaper later item may still fit.
    The quantity is forecasted_demand (decided 2026-11-12, no stock data exists).
    """
    budget_cents = budget_to_cents(budget)
    remaining_cents = budget_cents
    full_cents = 0
    items = []

    for priority, forecast in enumerate(rank_forecasts(forecasts), start=1):
        sku = forecast["item_sku"]
        entry = RESTOCK_CATALOG.get(sku)
        if entry is None:
            logger.warning("No restock price for %s, skipping", sku)
            continue

        quantity = forecast["forecasted_demand"]
        unit_cents = to_cents(entry["unit_cost"])
        line_cents = unit_cents * quantity
        # 2026-11-12: full_cost counts every priced item, whatever the budget is.
        # The slider maximum is derived from it.
        full_cents += line_cents

        if quantity <= 0 or line_cents > remaining_cents:
            continue

        remaining_cents -= line_cents
        items.append({
            "sku": sku,
            "name": forecast["item_name"],
            "trend": forecast["trend"],
            "current_demand": forecast["current_demand"],
            "forecasted_demand": forecast["forecasted_demand"],
            "growth_pct": _growth_pct(forecast["current_demand"], forecast["forecasted_demand"]),
            "quantity": quantity,
            "unit_cost": entry["unit_cost"],
            "line_total": line_cents / 100,
            "supplier_name": entry["supplier_name"],
            "lead_time_days": entry["lead_time_days"],
            "priority": priority,
        })

    return {
        "budget": budget_cents / 100,
        "full_cost": full_cents / 100,
        "total_cost": (budget_cents - remaining_cents) / 100,
        "remaining_budget": remaining_cents / 100,
        "items": items,
    }


def _next_order_number(existing_orders: List[dict], year: int) -> str:
    """Next RST-YYYY-NNNN number for the year.

    2026-11-12: Uses max + 1 over existing numbers, not len(), so numbers stay
    unique even if an entry is ever removed.
    """
    prefix = f"RST-{year}-"
    used = [
        int(order["order_number"].removeprefix(prefix))
        for order in existing_orders
        if order["order_number"].startswith(prefix)
    ]
    return f"{prefix}{max(used, default=0) + 1:04d}"


def build_order(
    lines: List[Tuple[str, int]],
    budget: float,
    existing_orders: List[dict],
    now: datetime,
) -> dict:
    """Price a submitted restocking order from the catalog and check it against the budget.

    2026-11-12: The client never sends prices. Unit cost always comes from
    RESTOCK_CATALOG, so the total cannot be tampered with. Raises ValueError for
    business-rule failures, and main.py turns those into HTTP 400.
    """
    budget_cents = budget_to_cents(budget)
    seen = set()
    priced_lines = []
    total_cents = 0

    for sku, quantity in lines:
        if sku in seen:
            raise ValueError(f"Duplicate SKU in order: {sku}")
        seen.add(sku)

        entry = RESTOCK_CATALOG.get(sku)
        if entry is None:
            raise ValueError(f"Unknown restock SKU: {sku}")

        unit_cents = to_cents(entry["unit_cost"])
        line_cents = unit_cents * quantity
        total_cents += line_cents
        priced_lines.append({
            "sku": sku,
            "name": entry["name"],
            "quantity": quantity,
            "unit_cost": entry["unit_cost"],
            "line_total": line_cents / 100,
            "supplier_name": entry["supplier_name"],
            "lead_time_days": entry["lead_time_days"],
        })

    if total_cents > budget_cents:
        raise ValueError(
            f"Order total ${total_cents / 100:,.2f} exceeds budget ${budget_cents / 100:,.2f}"
        )

    # 2026-11-12: The order arrives when its slowest item arrives, so the order
    # lead time is the maximum item lead time.
    lead_time_days = max(line["lead_time_days"] for line in priced_lines)
    order_date = now.replace(microsecond=0)
    expected_delivery = order_date + timedelta(days=lead_time_days)
    order_number = _next_order_number(existing_orders, order_date.year)

    return {
        "id": order_number,
        "order_number": order_number,
        "status": "Submitted",
        "budget": budget_cents / 100,
        "order_date": order_date.isoformat(),
        "expected_delivery": expected_delivery.isoformat(),
        "lead_time_days": lead_time_days,
        "total_value": total_cents / 100,
        "items": priced_lines,
    }
