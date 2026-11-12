// 2026-11-12: In-browser stand-in for the FastAPI backend, used when VITE_DEMO=true
// (GitHub Pages has no server). Every method mirrors server/main.py and
// server/restocking.py: same filters, same rounding, same response fields and same
// error messages. This file must not use import.meta so it can be bundled for Node tests.

import inventoryItems from '../../../server/data/inventory.json'
import orders from '../../../server/data/orders.json'
import demandForecasts from '../../../server/data/demand_forecasts.json'
import backlogItems from '../../../server/data/backlog_items.json'
import spendingData from '../../../server/data/spending.json'
import recentTransactions from '../../../server/data/transactions.json'
import purchaseOrders from '../../../server/data/purchase_orders.json'

// Field lists copied from the Pydantic response models in server/main.py.
// FastAPI drops keys outside the model and fills missing Optional keys with null.
const INVENTORY_FIELDS = ['id', 'sku', 'name', 'category', 'warehouse', 'quantity_on_hand', 'reorder_point', 'unit_cost', 'location', 'last_updated']
const ORDER_FIELDS = ['id', 'order_number', 'customer', 'items', 'status', 'order_date', 'expected_delivery', 'total_value', 'actual_delivery', 'warehouse', 'category']
const DEMAND_FIELDS = ['id', 'item_sku', 'item_name', 'current_demand', 'forecasted_demand', 'trend', 'period']
const BACKLOG_FIELDS = ['id', 'order_id', 'item_sku', 'item_name', 'quantity_needed', 'quantity_available', 'days_delayed', 'priority', 'has_purchase_order']

const QUARTER_MAP = {
  'Q1-2025': ['2025-01', '2025-02', '2025-03'],
  'Q2-2025': ['2025-04', '2025-05', '2025-06'],
  'Q3-2025': ['2025-07', '2025-08', '2025-09'],
  'Q4-2025': ['2025-10', '2025-11', '2025-12'],
}

// 2026-11-12: Restocking catalog copied from RESTOCK_CATALOG in server/restocking.py.
// Keep both copies in sync. SNR-420, CTL-330 and every supplier name are assumptions.
const RESTOCK_CATALOG = {
  'WDG-001': { name: 'Industrial Widget Type A', unit_cost: 24.99, supplier_name: 'Acme Components', lead_time_days: 14 },
  'BRG-102': { name: 'Steel Bearing Assembly', unit_cost: 89.50, supplier_name: 'Precision Bearings Co', lead_time_days: 21 },
  'GSK-203': { name: 'High-Temperature Gasket', unit_cost: 12.75, supplier_name: 'SealTech Supply', lead_time_days: 10 },
  'MTR-304': { name: 'Electric Motor 5HP', unit_cost: 445.00, supplier_name: 'Motion Dynamics', lead_time_days: 30 },
  'FLT-405': { name: 'Oil Filter Cartridge', unit_cost: 8.25, supplier_name: 'CleanFlow Industrial', lead_time_days: 7 },
  'VLV-506': { name: 'Pressure Relief Valve', unit_cost: 156.00, supplier_name: 'FluidControl Ltd', lead_time_days: 21 },
  'PSU-501': { name: '5V 10A Switching Power Supply', unit_cost: 18.99, supplier_name: 'PowerGrid Supply', lead_time_days: 14 },
  'SNR-420': { name: 'Temperature Sensor Module', unit_cost: 34.50, supplier_name: 'SenseTech', lead_time_days: 18 },
  'CTL-330': { name: 'Logic Controller Board', unit_cost: 62.00, supplier_name: 'CtrlLogic', lead_time_days: 12 },
}

const TREND_RANK = { increasing: 0, stable: 1, decreasing: 2 }
const UNKNOWN_TREND_RANK = 3

// In-memory state. Resets on page reload, like the backend list resets on restart.
// Single-threaded JS means no lock is needed (the backend needs one for its threadpool).
const submittedRestockOrders = []
const demoTasks = []
let demoTaskSequence = 0
let demoPurchaseOrderSequence = 0

// Helpers

const clone = (value) => structuredClone(value)

function httpError(status, detail) {
  const message = typeof detail === 'string' ? detail : `Request failed with status code ${status}`
  const err = new Error(message)
  err.response = { status, data: { detail } }
  return err
}

// 2026-11-12: Python round(x, n) rounds exact ties to the even digit, but
// Number.prototype.toFixed rounds them up (round(0.125, 2) is 0.12 in Python).
// Reading the exact decimal expansion with toFixed(n + 60) lets us apply Python's
// rule, so money and percentage values match the backend to the last digit.
function pyRound(x, digits = 0) {
  if (!Number.isFinite(x)) return x
  const sign = x < 0 ? '-' : ''
  const expanded = Math.abs(x).toFixed(digits + 60)
  const [intPart, fracPart = ''] = expanded.split('.')
  const kept = intPart + fracPart.slice(0, digits)
  const rest = fracPart.slice(digits)
  const roundUp = /^50*$/.test(rest)
    ? Number(kept.slice(-1)) % 2 === 1
    : rest[0] >= '5'
  const digitString = roundUp ? (BigInt(kept) + 1n).toString() : kept
  return Number(`${sign}${digitString}e-${digits}`)
}

// 2026-11-12: Python 3.12+ sum() over floats uses compensated (Neumaier) summation, so
// totals can differ from a plain reduce in the last digit. This mirrors CPython's algorithm.
function pySum(values) {
  let total = 0
  let compensation = 0
  for (const x of values) {
    const t = total + x
    if (Math.abs(total) >= Math.abs(x)) compensation += (total - t) + x
    else compensation += (x - t) + total
    total = t
  }
  return total + compensation
}

// Python f"{x:,.2f}" for non-negative amounts.
function formatUsd(amount) {
  const [whole, cents] = pyRound(amount, 2).toFixed(2).split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`
}

function project(source, fields) {
  const out = {}
  for (const field of fields) {
    out[field] = source[field] === undefined ? null : source[field]
  }
  return out
}

function applyFilters(items, { warehouse, category, status } = {}) {
  let filtered = items
  if (warehouse && warehouse !== 'all') {
    filtered = filtered.filter((item) => item.warehouse === warehouse)
  }
  if (category && category !== 'all') {
    const wanted = category.toLowerCase()
    filtered = filtered.filter((item) => (item.category ?? '').toLowerCase() === wanted)
  }
  if (status && status !== 'all') {
    const wanted = status.toLowerCase()
    filtered = filtered.filter((item) => (item.status ?? '').toLowerCase() === wanted)
  }
  return filtered
}

// Mirrors filter_by_month in server/main.py. Quarters use QUARTER_MAP. Any other
// value starting with Q is returned unchanged. Other values are substring matches.
function filterByMonth(items, month) {
  if (!month || month === 'all') return items
  if (month.startsWith('Q')) {
    if (!Object.prototype.hasOwnProperty.call(QUARTER_MAP, month)) return items
    const months = QUARTER_MAP[month]
    return items.filter((item) => months.some((m) => (item.order_date ?? '').includes(m)))
  }
  return items.filter((item) => (item.order_date ?? '').includes(month))
}

// Validation (mirrors Pydantic error objects in FastAPI 422 responses)

function floatErrors(value, loc, ge, le) {
  if (!Number.isFinite(value)) {
    return [{ type: 'finite_number', loc, msg: 'Input should be a finite number', input: value }]
  }
  const errors = []
  if (value < ge) {
    errors.push({ type: 'greater_than_equal', loc, msg: `Input should be greater than or equal to ${ge}`, input: value, ctx: { ge } })
  }
  if (value > le) {
    errors.push({ type: 'less_than_equal', loc, msg: `Input should be less than or equal to ${le}`, input: value, ctx: { le } })
  }
  return errors
}

function restockBudgetErrors(budget, loc) {
  return floatErrors(budget, loc, 0, 10000000)
}

function restockLineErrors(line, index) {
  const base = ['body', 'items', index]
  const errors = []
  const sku = line?.sku
  if (typeof sku !== 'string') {
    errors.push({ type: 'string_type', loc: [...base, 'sku'], msg: 'Input should be a valid string', input: sku })
  } else if ([...sku].length < 1) {
    errors.push({ type: 'string_too_short', loc: [...base, 'sku'], msg: 'String should have at least 1 character', input: sku, ctx: { min_length: 1 } })
  } else if ([...sku].length > 32) {
    errors.push({ type: 'string_too_long', loc: [...base, 'sku'], msg: 'String should have at most 32 characters', input: sku, ctx: { max_length: 32 } })
  }

  const quantity = line?.quantity
  const quantityLoc = [...base, 'quantity']
  if (!Number.isInteger(quantity)) {
    if (Number.isFinite(quantity)) {
      errors.push({ type: 'int_from_float', loc: quantityLoc, msg: 'Input should be a valid integer, got a number with a fractional part', input: quantity })
    } else {
      errors.push({ type: 'int_type', loc: quantityLoc, msg: 'Input should be a valid integer', input: quantity })
    }
  } else if (quantity <= 0) {
    errors.push({ type: 'greater_than', loc: quantityLoc, msg: 'Input should be greater than 0', input: quantity, ctx: { gt: 0 } })
  } else if (quantity > 100000) {
    errors.push({ type: 'less_than_equal', loc: quantityLoc, msg: 'Input should be less than or equal to 100000', input: quantity, ctx: { le: 100000 } })
  }
  return errors
}

function validateRestockOrderPayload(payload) {
  const errors = [...restockBudgetErrors(payload?.budget, ['body', 'budget'])]
  const items = payload?.items
  if (!Array.isArray(items)) {
    errors.push({ type: 'list_type', loc: ['body', 'items'], msg: 'Input should be a valid list', input: items })
  } else if (items.length < 1) {
    errors.push({
      type: 'too_short',
      loc: ['body', 'items'],
      msg: 'List should have at least 1 item after validation, not 0',
      input: items,
      ctx: { field_type: 'List', min_length: 1, actual_length: 0 },
    })
  } else {
    items.forEach((line, index) => errors.push(...restockLineErrors(line, index)))
  }
  if (errors.length > 0) throw httpError(422, errors)
}

// Restocking rules (mirrors server/restocking.py)

function toCents(amount) {
  return pyRound(amount * 100, 0)
}

function budgetToCents(budget) {
  return Math.floor(pyRound(budget * 100, 6))
}

function growthFraction(current, forecast) {
  if (current === 0) return forecast > 0 ? Infinity : 0
  return (forecast - current) / current
}

// 2026-11-12: Plain subtraction on Infinity gives NaN, so growth is compared with
// < and >. Order: trend, then growth descending, then SKU ascending.
function compareForecasts(a, b) {
  const trendA = Object.prototype.hasOwnProperty.call(TREND_RANK, a.trend) ? TREND_RANK[a.trend] : UNKNOWN_TREND_RANK
  const trendB = Object.prototype.hasOwnProperty.call(TREND_RANK, b.trend) ? TREND_RANK[b.trend] : UNKNOWN_TREND_RANK
  if (trendA !== trendB) return trendA - trendB
  const growthA = -growthFraction(a.current_demand, a.forecasted_demand)
  const growthB = -growthFraction(b.current_demand, b.forecasted_demand)
  if (growthA !== growthB) return growthA < growthB ? -1 : 1
  if (a.item_sku === b.item_sku) return 0
  return a.item_sku < b.item_sku ? -1 : 1
}

function growthPct(current, forecast) {
  const growth = growthFraction(current, forecast)
  return Number.isFinite(growth) ? pyRound(growth * 100, 2) : null
}

// 2026-11-12: Greedy by priority. An item that does not fit is skipped, and the loop
// keeps going because a cheaper later item may still fit. full_cost counts every priced item.
function buildRecommendations(forecasts, budget) {
  const budgetCents = budgetToCents(budget)
  let remainingCents = budgetCents
  let fullCents = 0
  const items = []

  const ranked = [...forecasts].sort(compareForecasts)
  ranked.forEach((forecast, index) => {
    const sku = forecast.item_sku
    if (!Object.prototype.hasOwnProperty.call(RESTOCK_CATALOG, sku)) return
    const entry = RESTOCK_CATALOG[sku]
    const quantity = forecast.forecasted_demand
    const unitCents = toCents(entry.unit_cost)
    const lineCents = unitCents * quantity
    fullCents += lineCents
    if (quantity <= 0 || lineCents > remainingCents) return

    remainingCents -= lineCents
    items.push({
      sku,
      name: forecast.item_name,
      trend: forecast.trend,
      current_demand: forecast.current_demand,
      forecasted_demand: forecast.forecasted_demand,
      growth_pct: growthPct(forecast.current_demand, forecast.forecasted_demand),
      quantity,
      unit_cost: entry.unit_cost,
      line_total: lineCents / 100,
      supplier_name: entry.supplier_name,
      lead_time_days: entry.lead_time_days,
      priority: index + 1,
    })
  })

  return {
    budget: budgetCents / 100,
    full_cost: fullCents / 100,
    total_cost: (budgetCents - remainingCents) / 100,
    remaining_budget: remainingCents / 100,
    items,
  }
}

// 2026-11-12: Next number is max + 1 over existing numbers of the same year, so numbers
// stay unique even if an entry is removed.
function nextOrderNumber(existingOrders, year) {
  const prefix = `RST-${year}-`
  let highest = 0
  for (const order of existingOrders) {
    if (order.order_number.startsWith(prefix)) {
      highest = Math.max(highest, Number(order.order_number.slice(prefix.length)))
    }
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`
}

// 2026-11-12: Naive timestamps like Python datetime.isoformat() for a naive datetime:
// local wall-clock time, no milliseconds, no timezone. Date.UTC arithmetic keeps the
// wall clock fixed across DST changes, the same way Python's naive timedelta does.
function naiveIso(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function buildOrder(lines, budget, existingOrders, now) {
  const budgetCents = budgetToCents(budget)
  const seen = new Set()
  const pricedLines = []
  let totalCents = 0

  for (const [sku, quantity] of lines) {
    if (seen.has(sku)) throw httpError(400, `Duplicate SKU in order: ${sku}`)
    seen.add(sku)
    if (!Object.prototype.hasOwnProperty.call(RESTOCK_CATALOG, sku)) {
      throw httpError(400, `Unknown restock SKU: ${sku}`)
    }
    const entry = RESTOCK_CATALOG[sku]
    const lineCents = toCents(entry.unit_cost) * quantity
    totalCents += lineCents
    pricedLines.push({
      sku,
      name: entry.name,
      quantity,
      unit_cost: entry.unit_cost,
      line_total: lineCents / 100,
      supplier_name: entry.supplier_name,
      lead_time_days: entry.lead_time_days,
    })
  }

  if (totalCents > budgetCents) {
    throw httpError(400, `Order total $${formatUsd(totalCents / 100)} exceeds budget $${formatUsd(budgetCents / 100)}`)
  }

  // 2026-11-12: The order arrives when its slowest item arrives.
  const leadTimeDays = Math.max(...pricedLines.map((line) => line.lead_time_days))
  // Wall-clock components of "now" in local time, as Python's datetime.now() returns.
  const orderMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds())
  const deliveryMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + leadTimeDays, now.getHours(), now.getMinutes(), now.getSeconds())
  const orderNumber = nextOrderNumber(existingOrders, now.getFullYear())

  return {
    id: orderNumber,
    order_number: orderNumber,
    status: 'Submitted',
    budget: budgetCents / 100,
    order_date: naiveIso(orderMs),
    expected_delivery: naiveIso(deliveryMs),
    lead_time_days: leadTimeDays,
    total_value: totalCents / 100,
    items: pricedLines,
  }
}

// Public API

export const demoApi = {
  async getInventory(filters = {}) {
    const items = applyFilters(inventoryItems, { warehouse: filters.warehouse, category: filters.category })
    return clone(items.map((item) => project(item, INVENTORY_FIELDS)))
  },

  async getInventoryItem(id) {
    const item = inventoryItems.find((entry) => entry.id === id)
    if (!item) throw httpError(404, 'Item not found')
    return clone(project(item, INVENTORY_FIELDS))
  },

  async getOrders(filters = {}) {
    let filtered = applyFilters(orders, filters)
    filtered = filterByMonth(filtered, filters.month)
    return clone(filtered.map((order) => project(order, ORDER_FIELDS)))
  },

  async getOrder(id) {
    const order = orders.find((entry) => entry.id === id)
    if (!order) throw httpError(404, 'Order not found')
    return clone(project(order, ORDER_FIELDS))
  },

  async getDemandForecasts() {
    return clone(demandForecasts.map((item) => project(item, DEMAND_FIELDS)))
  },

  async getBacklog() {
    return clone(backlogItems.map((item) => {
      const hasPurchaseOrder = purchaseOrders.some((po) => po.backlog_item_id === item.id)
      return project({ ...item, has_purchase_order: hasPurchaseOrder }, BACKLOG_FIELDS)
    }))
  },

  async getDashboardSummary(filters = {}) {
    const filteredInventory = applyFilters(inventoryItems, { warehouse: filters.warehouse, category: filters.category })
    let filteredOrders = applyFilters(orders, filters)
    filteredOrders = filterByMonth(filteredOrders, filters.month)

    const totalInventoryValue = pySum(filteredInventory.map((item) => item.quantity_on_hand * item.unit_cost))
    const lowStockItems = filteredInventory.filter((item) => item.quantity_on_hand <= item.reorder_point).length
    const pendingOrders = filteredOrders.filter((order) => ['Processing', 'Backordered'].includes(order.status)).length
    const totalOrdersValue = pySum(filteredOrders.map((order) => order.total_value))

    return {
      total_inventory_value: pyRound(totalInventoryValue, 2),
      low_stock_items: lowStockItems,
      pending_orders: pendingOrders,
      // Counts every backlog item, ignoring filters, as the backend does.
      total_backlog_items: backlogItems.length,
      total_orders_value: totalOrdersValue,
    }
  },

  async getSpendingSummary() {
    return clone(spendingData.spending_summary)
  },

  async getMonthlySpending() {
    return clone(spendingData.monthly_spending)
  },

  async getCategorySpending() {
    return clone(spendingData.category_spending)
  },

  async getTransactions() {
    return clone(recentTransactions)
  },

  async getQuarterlyReports() {
    // Mirrors get_quarterly_reports in server/main.py. The 2025 quarter detection is hardcoded there too.
    const quarters = {}
    for (const order of orders) {
      const orderDate = order.order_date ?? ''
      let quarter
      if (['2025-01', '2025-02', '2025-03'].some((m) => orderDate.includes(m))) quarter = 'Q1-2025'
      else if (['2025-04', '2025-05', '2025-06'].some((m) => orderDate.includes(m))) quarter = 'Q2-2025'
      else if (['2025-07', '2025-08', '2025-09'].some((m) => orderDate.includes(m))) quarter = 'Q3-2025'
      else if (['2025-10', '2025-11', '2025-12'].some((m) => orderDate.includes(m))) quarter = 'Q4-2025'
      else continue

      if (!quarters[quarter]) {
        quarters[quarter] = {
          quarter,
          total_orders: 0,
          total_revenue: 0,
          delivered_orders: 0,
          avg_order_value: 0,
        }
      }
      const data = quarters[quarter]
      data.total_orders += 1
      data.total_revenue += order.total_value ?? 0
      if (order.status === 'Delivered') data.delivered_orders += 1
    }

    const result = []
    for (const data of Object.values(quarters)) {
      if (data.total_orders > 0) {
        data.avg_order_value = pyRound(data.total_revenue / data.total_orders, 2)
        data.fulfillment_rate = pyRound((data.delivered_orders / data.total_orders) * 100, 1)
      }
      result.push(data)
    }
    result.sort((a, b) => (a.quarter < b.quarter ? -1 : a.quarter > b.quarter ? 1 : 0))
    return clone(result)
  },

  async getMonthlyTrends() {
    // Mirrors get_monthly_trends in server/main.py. The month key is order_date[:7].
    const months = {}
    for (const order of orders) {
      const orderDate = order.order_date ?? ''
      if (!orderDate) continue
      const month = orderDate.slice(0, 7)
      if (!months[month]) {
        months[month] = { month, order_count: 0, revenue: 0, delivered_count: 0 }
      }
      const data = months[month]
      data.order_count += 1
      data.revenue += order.total_value ?? 0
      if (order.status === 'Delivered') data.delivered_count += 1
    }
    const result = Object.values(months)
    result.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    return clone(result)
  },

  // Tasks live only in memory. The backend has no /api/tasks routes.
  async getTasks() {
    return clone(demoTasks)
  },

  async createTask(taskData = {}) {
    demoTaskSequence += 1
    const task = { ...taskData, id: `demo-task-${demoTaskSequence}`, status: 'pending' }
    demoTasks.unshift(task)
    return clone(task)
  },

  async deleteTask(taskId) {
    const index = demoTasks.findIndex((task) => task.id === taskId)
    if (index === -1) throw httpError(404, 'Task not found')
    demoTasks.splice(index, 1)
    return { message: 'Task deleted' }
  },

  async toggleTask(taskId) {
    const task = demoTasks.find((entry) => entry.id === taskId)
    if (!task) throw httpError(404, 'Task not found')
    task.status = task.status === 'pending' ? 'completed' : 'pending'
    return clone(task)
  },

  // 2026-11-12: The backend has no purchase-order routes, and purchase_orders.json is empty.
  // Returning null means "no purchase order for this backlog item", which is what the
  // backend's has_purchase_order flag already says for every item.
  async getPurchaseOrderByBacklogItem() {
    return null
  },

  // 2026-11-12: Nothing in the app calls this method. The backend has no purchase-order
  // route either. This returns a plausible PurchaseOrder shape so the call does not fail
  // if a caller uses it. Nothing is stored.
  async createPurchaseOrder(purchaseOrderData = {}) {
    demoPurchaseOrderSequence += 1
    return {
      id: `demo-po-${demoPurchaseOrderSequence}`,
      status: 'Pending',
      created_date: naiveIso(Date.now()).slice(0, 10),
      notes: null,
      ...purchaseOrderData,
    }
  },

  async getRestockRecommendations(budget = 0) {
    const errors = floatErrors(budget, ['query', 'budget'], 0, 10000000).map((error) => ({
      ...error,
      input: String(budget),
    }))
    if (errors.length > 0) throw httpError(422, errors)
    return clone(buildRecommendations(demandForecasts, budget))
  },

  async placeRestockOrder(payload) {
    validateRestockOrderPayload(payload)
    const lines = payload.items.map((line) => [line.sku, line.quantity])
    const order = buildOrder(lines, payload.budget, submittedRestockOrders, new Date())
    submittedRestockOrders.push(order)
    return clone(order)
  },

  async getSubmittedRestockOrders() {
    // Insertion order is chronological, so reversing gives newest first.
    return clone([...submittedRestockOrders].reverse())
  },
}
