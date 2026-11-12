"""
Tests for the Restocking endpoints (recommendations and submitted orders).

2026-11-12: Expected values come from the sample calculation in the Restocking
plan, using demand_forecasts.json and RESTOCK_CATALOG. If either data file
changes, these expectations must be recalculated.
"""
import copy
import re
from datetime import datetime, timedelta

import mock_data

FLOAT_TOLERANCE = 0.01


def _close(a, b):
    return abs(a - b) < FLOAT_TOLERANCE


class TestRestockRecommendationsEndpoint:
    """Tests for GET /api/restocking/recommendations."""

    def test_budget_zero_returns_no_items_and_full_cost(self, client):
        """Budget 0 funds nothing, but full_cost still reports the cost of every priced item."""
        response = client.get("/api/restocking/recommendations", params={"budget": 0})

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total_cost"] == 0
        assert data["remaining_budget"] == 0
        assert _close(data["full_cost"], 91804.48)

    def test_budget_10000_picks_only_gasket(self, client):
        """WDG-001 (11245.50) does not fit, so the pass skips it and funds GSK-203 (7650.00)."""
        response = client.get("/api/restocking/recommendations", params={"budget": 10000})

        assert response.status_code == 200
        data = response.json()
        assert [item["sku"] for item in data["items"]] == ["GSK-203"]
        assert _close(data["total_cost"], 7650.00)
        assert _close(data["remaining_budget"], 2350.00)

    def test_skipped_item_keeps_its_priority_position(self, client):
        """Skip-and-continue: GSK-203 keeps priority 2 even though WDG-001 (priority 1) was skipped."""
        response = client.get("/api/restocking/recommendations", params={"budget": 10000})

        items = response.json()["items"]
        assert items[0]["sku"] == "GSK-203"
        assert items[0]["priority"] == 2

    def test_budget_30000_picks_three_increasing_items(self, client):
        """WDG-001, GSK-203 and FLT-405 fit: total 26733.00, leaving 3267.00."""
        response = client.get("/api/restocking/recommendations", params={"budget": 30000})

        assert response.status_code == 200
        data = response.json()
        assert [item["sku"] for item in data["items"]] == ["WDG-001", "GSK-203", "FLT-405"]
        assert _close(data["total_cost"], 26733.00)
        assert _close(data["remaining_budget"], 3267.00)

    def test_full_budget_funds_every_item_exactly(self, client):
        """At exactly the full cost, all 9 items fit and nothing remains (cents arithmetic check)."""
        response = client.get("/api/restocking/recommendations", params={"budget": 91804.48})

        data = response.json()
        assert len(data["items"]) == 9
        assert _close(data["total_cost"], 91804.48)
        assert _close(data["remaining_budget"], 0)

    def test_ranking_is_trend_then_growth(self, client):
        """Increasing items first (by growth), then stable (by growth), then decreasing."""
        response = client.get("/api/restocking/recommendations", params={"budget": 91804.48})

        skus = [item["sku"] for item in response.json()["items"]]
        assert skus == [
            "WDG-001", "GSK-203", "FLT-405",
            "BRG-102", "SNR-420", "CTL-330", "VLV-506", "PSU-501",
            "MTR-304",
        ]

    def test_quantity_equals_forecasted_demand(self, client):
        """2026-11-12: quantity is forecasted_demand (decided by the user, no stock data exists)."""
        response = client.get("/api/restocking/recommendations", params={"budget": 30000})

        for item in response.json()["items"]:
            assert item["quantity"] == item["forecasted_demand"]

    def test_total_matches_sum_of_line_totals(self, client):
        """total_cost is the sum of line totals, and remaining_budget is budget minus total."""
        budget = 30000
        response = client.get("/api/restocking/recommendations", params={"budget": budget})

        data = response.json()
        line_sum = sum(item["line_total"] for item in data["items"])
        assert _close(data["total_cost"], line_sum)
        assert _close(data["remaining_budget"], budget - data["total_cost"])

    def test_response_structure(self, client):
        """Every item carries the fields the frontend needs."""
        response = client.get("/api/restocking/recommendations", params={"budget": 30000})

        data = response.json()
        for key in ("budget", "full_cost", "total_cost", "remaining_budget", "items"):
            assert key in data
        required = {
            "sku", "name", "trend", "current_demand", "forecasted_demand", "growth_pct",
            "quantity", "unit_cost", "line_total", "supplier_name", "lead_time_days", "priority",
        }
        for item in data["items"]:
            assert required.issubset(item.keys())
            assert isinstance(item["priority"], int)

    def test_negative_budget_returns_422(self, client):
        """Budget must be >= 0."""
        response = client.get("/api/restocking/recommendations", params={"budget": -1})
        assert response.status_code == 422

    def test_non_numeric_budget_returns_422(self, client):
        """Budget must be a number."""
        response = client.get("/api/restocking/recommendations", params={"budget": "lots"})
        assert response.status_code == 422

    def test_nan_and_inf_budget_return_422(self, client):
        """nan and inf parse as floats but must be rejected."""
        for raw in ("nan", "inf"):
            response = client.get("/api/restocking/recommendations", params={"budget": raw})
            assert response.status_code == 422, raw

    def test_does_not_mutate_demand_forecasts(self, client):
        """Ranking works on a sorted copy, so the source forecasts stay unchanged."""
        before = copy.deepcopy(mock_data.demand_forecasts)

        client.get("/api/restocking/recommendations", params={"budget": 91804.48})

        assert mock_data.demand_forecasts == before


class TestRestockOrdersEndpoint:
    """Tests for POST and GET /api/restocking/orders."""

    def test_valid_order_returns_201_with_repriced_total(self, client):
        """GSK-203 x 600 at 12.75 = 7650.00. Lead time is GSK-203's 10 days."""
        response = client.post(
            "/api/restocking/orders",
            json={"budget": 30000, "items": [{"sku": "GSK-203", "quantity": 600}]},
        )

        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "Submitted"
        assert _close(data["total_value"], 7650.00)
        assert data["lead_time_days"] == 10

    def test_client_sent_price_is_ignored(self, client):
        """The server prices from the catalog. A client unit_cost of 0.01 changes nothing."""
        response = client.post(
            "/api/restocking/orders",
            json={
                "budget": 30000,
                "items": [{"sku": "GSK-203", "quantity": 600, "unit_cost": 0.01}],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert _close(data["total_value"], 7650.00)
        assert _close(data["items"][0]["unit_cost"], 12.75)

    def test_lead_time_is_longest_item(self, client):
        """FLT-405 takes 7 days and BRG-102 takes 21. The order lead time is 21."""
        response = client.post(
            "/api/restocking/orders",
            json={
                "budget": 10000,
                "items": [
                    {"sku": "FLT-405", "quantity": 10},
                    {"sku": "BRG-102", "quantity": 1},
                ],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["lead_time_days"] == 21
        order_date = datetime.fromisoformat(data["order_date"])
        expected = datetime.fromisoformat(data["expected_delivery"])
        assert expected - order_date == timedelta(days=21)

    def test_order_numbers_follow_format_and_increment(self, client):
        """Order numbers look like RST-YYYY-NNNN and increase by one."""
        payload = {"budget": 10000, "items": [{"sku": "GSK-203", "quantity": 1}]}

        first = client.post("/api/restocking/orders", json=payload).json()
        second = client.post("/api/restocking/orders", json=payload).json()

        pattern = r"RST-\d{4}-\d{4}"
        assert re.fullmatch(pattern, first["order_number"])
        assert re.fullmatch(pattern, second["order_number"])
        assert second["order_number"].endswith("0002")
        assert first["order_number"].endswith("0001")

    def test_unknown_sku_returns_400(self, client):
        """SKUs outside the restocking catalog are rejected."""
        response = client.post(
            "/api/restocking/orders",
            json={"budget": 10000, "items": [{"sku": "NOPE-999", "quantity": 1}]},
        )

        assert response.status_code == 400
        assert "NOPE-999" in response.json()["detail"]

    def test_duplicate_sku_returns_400(self, client):
        """The same SKU may appear only once per order."""
        response = client.post(
            "/api/restocking/orders",
            json={
                "budget": 10000,
                "items": [
                    {"sku": "GSK-203", "quantity": 1},
                    {"sku": "GSK-203", "quantity": 2},
                ],
            },
        )

        assert response.status_code == 400
        assert "Duplicate" in response.json()["detail"]

    def test_over_budget_returns_400_and_is_not_stored(self, client):
        """A total above budget is rejected and nothing is saved."""
        response = client.post(
            "/api/restocking/orders",
            json={"budget": 100, "items": [{"sku": "GSK-203", "quantity": 600}]},
        )

        assert response.status_code == 400
        assert "exceeds budget" in response.json()["detail"]
        assert client.get("/api/restocking/orders").json() == []

    def test_empty_items_returns_422(self, client):
        """At least one item is required."""
        response = client.post("/api/restocking/orders", json={"budget": 100, "items": []})
        assert response.status_code == 422

    def test_invalid_quantities_return_422(self, client):
        """Quantity must be a positive integer up to the cap."""
        for quantity in (0, -1, 100001):
            response = client.post(
                "/api/restocking/orders",
                json={"budget": 10**7, "items": [{"sku": "GSK-203", "quantity": quantity}]},
            )
            assert response.status_code == 422, quantity

    def test_negative_budget_returns_422(self, client):
        """Budget must be >= 0."""
        response = client.post(
            "/api/restocking/orders",
            json={"budget": -5, "items": [{"sku": "GSK-203", "quantity": 1}]},
        )
        assert response.status_code == 422

    def test_get_lists_submitted_orders_newest_first(self, client):
        """GET returns submitted orders with the newest first."""
        payload = {"budget": 10000, "items": [{"sku": "GSK-203", "quantity": 1}]}
        client.post("/api/restocking/orders", json=payload)
        client.post("/api/restocking/orders", json=payload)

        listed = client.get("/api/restocking/orders").json()

        assert len(listed) == 2
        assert listed[0]["order_number"].endswith("0002")
        assert listed[1]["order_number"].endswith("0001")


class TestRestockCrossEndpoint:
    """Submitting restocking orders must not change existing order-based data."""

    def test_post_does_not_change_orders_or_dashboard(self, client):
        """Submitted orders stay out of /api/orders, the dashboard summary and the reports."""
        orders_before = client.get("/api/orders").json()
        summary_before = client.get("/api/dashboard/summary").json()
        quarterly_before = client.get("/api/reports/quarterly").json()

        client.post(
            "/api/restocking/orders",
            json={"budget": 10000, "items": [{"sku": "GSK-203", "quantity": 1}]},
        )

        assert client.get("/api/orders").json() == orders_before
        assert client.get("/api/dashboard/summary").json() == summary_before
        assert client.get("/api/reports/quarterly").json() == quarterly_before

    def test_restock_orders_are_not_in_demand_forecasts(self, client):
        """The demand endpoint returns the forecasts unchanged after a POST."""
        demand_before = client.get("/api/demand").json()

        client.post(
            "/api/restocking/orders",
            json={"budget": 10000, "items": [{"sku": "GSK-203", "quantity": 1}]},
        )

        assert client.get("/api/demand").json() == demand_before
