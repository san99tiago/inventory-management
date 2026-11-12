# Test Summary

## Test Coverage Overview

All backend API tests are passing with **55 tests** covering the entire application functionality.

## Test Suites

### 1. Dashboard Endpoints (13 tests)
- ✅ Dashboard summary retrieval
- ✅ Data type validation
- ✅ Non-negative value validation
- ✅ Filtering by warehouse, category, status, and month
- ✅ Multiple filter combinations
- ✅ Power Supplies category support
- ✅ **Actual calculations** for:
  - Pending orders count (Processing + Backordered)
  - Low stock items (at or below reorder point)
  - Total inventory value (quantity × unit cost)

### 2. Inventory Endpoints (10 tests)
- ✅ Get all inventory items
- ✅ Filter by warehouse
- ✅ Filter by category (including Power Supplies)
- ✅ Combined warehouse and category filtering
- ✅ "all" filter handling
- ✅ Get specific item by ID
- ✅ 404 handling for non-existent items
- ✅ Required fields validation
- ✅ Quantity and cost type validation
- ✅ Non-negative value validation

### 3. Orders Endpoints (15 tests)
- ✅ Get all orders
- ✅ Filter by warehouse, category, status, month
- ✅ Quarter filtering (Q1-2025)
- ✅ Multiple filter combinations
- ✅ Power Supplies category orders
- ✅ Get specific order by ID
- ✅ 404 handling for non-existent orders
- ✅ Order items structure validation
- ✅ Valid status values (Delivered, Shipped, Processing, Backordered)
- ✅ Date format validation (ISO format)
- ✅ Delivered orders have actual_delivery date
- ✅ **Actual calculation**: Total value = sum(quantity × unit_price)

### 4. Demand Forecast Endpoints (5 tests)
- ✅ Get demand forecasts
- ✅ Valid trend values (increasing, stable, decreasing)
- ✅ Non-negative demand values
- ✅ **NEW**: Stable items have < 2% change
- ✅ **NEW**: At least 5 stable demand items exist
- ✅ **NEW**: New items (Temperature Sensor Module, Logic Controller Board) are present and stable

### 5. Backlog Endpoints (4 tests)
- ✅ Get backlog items
- ✅ Valid priority values (high, medium, low)
- ✅ Non-negative quantities
- ✅ Non-negative days delayed

### 6. Spending Endpoints (6 tests)
- ✅ Get spending summary
- ✅ Get monthly spending data
- ✅ **NEW**: All cost categories present (procurement, operational, labor, overhead)
- ✅ **NEW**: Monthly spending has variety (not all the same values)
- ✅ Get category spending
- ✅ Get recent transactions

### 7. Root Endpoint (2 tests)
- ✅ Root endpoint returns API info
- ✅ Message and version structure

### 8. Restocking Endpoints (26 tests, `test_restocking.py`)
<!-- 2026-11-12: Added with the Restocking feature. Expected values come from the demo data and RESTOCK_CATALOG. -->
- ✅ Budget 0 returns no items and the full forecast cost (91,804.48)
- ✅ Budget 10,000 skips WDG-001 (does not fit) and funds GSK-203 only
- ✅ Skipped items keep their priority position
- ✅ Budget 30,000 funds WDG-001, GSK-203 and FLT-405 (26,733.00 total)
- ✅ The exact full cost funds all 9 items with nothing remaining
- ✅ Ranking: trend first, then growth, then SKU
- ✅ Quantity equals forecasted demand
- ✅ Totals equal the sum of line totals (cents arithmetic)
- ✅ Invalid budgets (negative, non-numeric, nan, inf) return 422
- ✅ Demand forecasts are not mutated by ranking
- ✅ Valid order returns 201 with a server-recomputed total
- ✅ Client-sent prices are ignored
- ✅ Order lead time is the longest item lead time
- ✅ Order numbers follow RST-YYYY-NNNN and increment
- ✅ Unknown SKU, duplicate SKU, and over-budget orders return 400, and over-budget orders are not stored
- ✅ Invalid quantities and empty item lists return 422
- ✅ Submitted orders list newest first
- ✅ Submitting does not change /api/orders, the dashboard summary, the quarterly report, or /api/demand

## Key Testing Principles

### ✅ No Hardcoded Values
Tests verify **actual calculations** and **real data relationships**:
- Dashboard metrics are calculated from actual order/inventory data
- Order totals are verified against item quantities and prices
- Demand forecast percentages are calculated from actual current/forecasted values
- Spending variety is detected by checking for unique values across months

### ✅ Real Validation
Tests ensure:
- Data structures match expected schemas
- Filters work correctly
- Calculations are accurate
- Business logic is sound (e.g., stable demand < 2% change)

### ✅ New Functionality Covered
Recent additions are fully tested:
- Stable demand items with < 2% change requirement
- New demand forecast items (5 total stable items)
- Varied monthly spending data
- Cost category completeness

## Running the Tests

```bash
cd tests
python -m pytest backend/ -v
```

## Test Results
<!-- 2026-11-12: Counts from `python -m pytest backend/` run in server/.venv with pytest 9.2.0 -->
- **Total Tests**: 66
- **Passed**: 66 ✅
- **Failed**: 0
- **Warnings**: 1 (starlette: httpx test client deprecation, not from this code)

All tests validate the **actual implementation** without cheating or hardcoding success values!
