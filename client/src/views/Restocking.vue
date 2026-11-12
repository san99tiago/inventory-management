<template>
  <div class="restocking">
    <div class="page-header">
      <h2>{{ t('restocking.title') }}</h2>
      <p>{{ t('restocking.description') }}</p>
    </div>

    <div class="card">
      <div class="budget-control">
        <div class="budget-row">
          <label for="restock-budget" class="budget-label">{{ t('restocking.budget') }}</label>
          <span class="budget-value">{{ formatCurrency(budget, currentCurrency) }}</span>
        </div>
        <!-- The slider is never wrapped in a v-if, so it keeps focus while the list loads -->
        <input
          id="restock-budget"
          class="budget-slider"
          type="range"
          min="0"
          step="500"
          :max="maxBudget"
          :value="budget"
          @input="onBudgetInput"
        />
        <p class="budget-hint">{{ t('restocking.budgetHint') }}</p>
        <p class="budget-hint">
          {{ t('restocking.fullCost') }}: <strong>{{ formatCurrency(fullCost, currentCurrency) }}</strong>
        </p>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">{{ t('restocking.recommended') }}</h3>
      </div>

      <div v-if="orderSuccess" class="success-banner" aria-live="polite">
        <span>
          {{ t('restocking.orderPlaced', { orderNumber: orderSuccess.order_number, days: orderSuccess.lead_time_days }) }}
        </span>
        <router-link to="/orders" class="banner-link">{{ t('restocking.viewOrders') }}</router-link>
      </div>

      <div v-if="submitError" class="error">{{ t('restocking.orderFailed') }}{{ submitError }}</div>

      <div v-if="loadError" class="error">{{ t('restocking.loadFailed') }}{{ loadError }}</div>
      <div v-else-if="loading" class="loading">{{ t('common.loading') }}</div>
      <template v-else>
        <div class="table-container">
          <table class="restock-table">
            <thead>
              <tr>
                <th class="col-check"></th>
                <th>{{ t('restocking.priority') }}</th>
                <th>{{ t('demand.table.itemName') }}</th>
                <th>{{ t('demand.table.trend') }}</th>
                <th>{{ t('demand.table.change') }}</th>
                <th>{{ t('restocking.quantity') }}</th>
                <th>{{ t('restocking.unitCost') }}</th>
                <th>{{ t('restocking.lineTotal') }}</th>
                <th>{{ t('restocking.supplier') }}</th>
                <th>{{ t('restocking.leadTime') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="items.length === 0">
                <td colspan="10" class="empty-row">{{ t('restocking.noItems') }}</td>
              </tr>
              <tr v-for="item in items" :key="item.sku">
                <td class="col-check">
                  <input
                    type="checkbox"
                    :checked="isChecked(item.sku)"
                    :aria-label="translateProductName(item.name)"
                    @change="toggleItem(item.sku)"
                  />
                </td>
                <td>{{ item.priority }}</td>
                <td>
                  <strong>{{ translateProductName(item.name) }}</strong>
                  <div class="sku">{{ item.sku }}</div>
                </td>
                <td>
                  <span :class="['badge', item.trend]">{{ t('trends.' + item.trend) }}</span>
                </td>
                <td>{{ formatGrowth(item.growth_pct) }}</td>
                <td>{{ item.quantity }}</td>
                <td>{{ formatMoney(item.unit_cost, currentCurrency) }}</td>
                <td><strong>{{ formatMoney(item.line_total, currentCurrency) }}</strong></td>
                <td>{{ item.supplier_name }}</td>
                <td>{{ t('restocking.days', { count: item.lead_time_days }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <div class="order-summary">
        <div class="summary-line">
          <span>{{ t('restocking.selectedCount', { count: checkedItems.length }) }}</span>
        </div>
        <div class="summary-line">
          <span>{{ t('restocking.orderTotal') }}</span>
          <strong>{{ formatMoney(orderTotal, currentCurrency) }}</strong>
        </div>
        <div class="summary-line">
          <span>{{ t('restocking.remaining') }}</span>
          <strong>{{ formatMoney(remaining, currentCurrency) }}</strong>
        </div>
        <p v-if="checkedItems.length === 0 && !loading" class="budget-hint">{{ t('restocking.nothingSelected') }}</p>
        <button
          type="button"
          class="place-order-btn"
          :disabled="checkedItems.length === 0 || submitting || loading"
          @click="placeOrder"
        >
          {{ submitting ? t('restocking.placingOrder') : t('restocking.placeOrder') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api'
import { useI18n } from '../composables/useI18n'
import { formatCurrency, formatCurrencyWithDecimals } from '../utils/currency'

const STEP = 500
const DEBOUNCE_MS = 250

// 2026-11-12: Unit costs and line totals need cents (12.75 would round to $13), so they use
// two decimals. The budget and full forecast cost are whole-dollar amounts and keep formatCurrency.
const formatMoney = (amount, currency) => formatCurrencyWithDecimals(amount, currency, 2)

export default {
  name: 'Restocking',
  setup() {
    const { t, currentCurrency, translateProductName } = useI18n()

    const budget = ref(0)
    const fullCost = ref(0)
    const maxBudget = ref(STEP)
    const items = ref([])
    const loading = ref(true)
    const loadError = ref(null)
    const submitting = ref(false)
    const submitError = ref(null)
    const orderSuccess = ref(null)
    const excluded = ref(new Set())

    let debounceTimer = null
    let requestId = 0

    const isChecked = (sku) => !excluded.value.has(sku)

    const toggleItem = (sku) => {
      const next = new Set(excluded.value)
      if (next.has(sku)) {
        next.delete(sku)
      } else {
        next.add(sku)
      }
      excluded.value = next
    }

    const checkedItems = computed(() => items.value.filter(i => isChecked(i.sku)))
    const orderTotal = computed(() => checkedItems.value.reduce((sum, i) => sum + i.line_total, 0))
    const remaining = computed(() => budget.value - orderTotal.value)

    const formatGrowth = (pct) => {
      if (pct === null || pct === undefined || isNaN(pct)) return '+n/a'
      const sign = pct >= 0 ? '+' : ''
      return `${sign}${pct.toFixed(1)}%`
    }

    const loadRecommendations = async () => {
      // 2026-11-12: Request id guard. Slider moves can fire overlapping requests, and a slow
      // older response must not overwrite a newer one, so only the latest id may apply results.
      const myId = ++requestId
      loading.value = true
      loadError.value = null
      try {
        const data = await api.getRestockRecommendations(budget.value)
        if (myId !== requestId) return
        items.value = data.items

        // 2026-11-12: Prune excluded SKUs that are no longer recommended, so a SKU that
        // leaves and later returns is checked again instead of silently staying unchecked.
        const present = new Set(data.items.map(i => i.sku))
        excluded.value = new Set([...excluded.value].filter(sku => present.has(sku)))
      } catch (err) {
        if (myId !== requestId) return
        loadError.value = err.response?.data?.detail || err.message
        console.error('Restocking load error:', err)
      } finally {
        if (myId === requestId) loading.value = false
      }
    }

    const onBudgetInput = (event) => {
      budget.value = Number(event.target.value)
      // 2026-11-12: Debounce so dragging the slider sends one request after it settles.
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(loadRecommendations, DEBOUNCE_MS)
    }

    const placeOrder = async () => {
      // 2026-11-12: Double-submit guard. Set the flag synchronously before the await so a
      // second click in the same tick cannot start a second request.
      if (submitting.value || checkedItems.value.length === 0) return
      submitting.value = true
      submitError.value = null
      orderSuccess.value = null
      try {
        // Only sku and quantity are sent. The server prices the lines itself.
        const order = await api.placeRestockOrder({
          budget: budget.value,
          items: checkedItems.value.map(i => ({ sku: i.sku, quantity: i.quantity }))
        })
        orderSuccess.value = order

        // 2026-11-12: Post-success reset. There is no stock state, so the same items return
        // after the refetch (known limitation of the approved plan).
        excluded.value = new Set()
        budget.value = 0
        clearTimeout(debounceTimer)
        await loadRecommendations()
      } catch (err) {
        submitError.value = err.response?.data?.detail || err.message
        console.error('Place order error:', err)
      } finally {
        submitting.value = false
      }
    }

    const init = async () => {
      try {
        // budget=0 call only to learn the full forecast cost for the slider max
        const data = await api.getRestockRecommendations(0)
        fullCost.value = data.full_cost
        maxBudget.value = Math.max(STEP, Math.ceil(data.full_cost / STEP) * STEP)
        budget.value = Math.round(maxBudget.value / 3 / STEP) * STEP
      } catch (err) {
        loadError.value = err.response?.data?.detail || err.message
        loading.value = false
        console.error('Restocking init error:', err)
        return
      }
      await loadRecommendations()
    }

    onMounted(init)

    onBeforeUnmount(() => {
      clearTimeout(debounceTimer)
      // Invalidate any in-flight request so it cannot touch state after unmount
      requestId++
    })

    return {
      t,
      currentCurrency,
      translateProductName,
      formatCurrency,
      formatMoney,
      budget,
      fullCost,
      maxBudget,
      items,
      loading,
      loadError,
      submitting,
      submitError,
      orderSuccess,
      checkedItems,
      orderTotal,
      remaining,
      isChecked,
      toggleItem,
      formatGrowth,
      onBudgetInput,
      placeOrder
    }
  }
}
</script>

<style scoped>
.restocking {
  max-width: 100%;
}

.budget-control {
  padding: 0.5rem 0;
}

.budget-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.budget-label {
  font-weight: 600;
  color: #0f172a;
}

.budget-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
}

.budget-slider {
  width: 100%;
  accent-color: #3b82f6;
}

.budget-hint {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: #64748b;
}

.restock-table {
  min-width: 900px;
}

.col-check {
  width: 40px;
}

.sku {
  font-size: 0.813rem;
  color: #64748b;
}

.empty-row {
  text-align: center;
  color: #64748b;
  padding: 1.5rem;
}

.order-summary {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.summary-line {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  color: #0f172a;
}

.place-order-btn {
  align-self: flex-end;
  margin-top: 0.5rem;
  padding: 0.625rem 1.25rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.938rem;
  cursor: pointer;
}

.place-order-btn:hover:not(:disabled) {
  background: #2563eb;
}

.place-order-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.success-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  background: #d1fae5;
  color: #059669;
  border: 1px solid #059669;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  font-weight: 500;
}

.banner-link {
  color: #059669;
  font-weight: 600;
  text-decoration: underline;
}

@media (max-width: 640px) {
  .place-order-btn {
    align-self: stretch;
  }
}
</style>
