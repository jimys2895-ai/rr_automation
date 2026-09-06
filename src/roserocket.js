require('dotenv').config();
const axios = require('axios');
const { getToken } = require('./auth');

const BASE_URL = (process.env.ROSEROCKET_ORG_URL || '').replace(/\/+$/, '');

async function apiHeaders() {
  const token = await getToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Cache-Control': 'no-cache,no-store,must-revalidate,max-age=-1,private',
    'x-requested-with': 'XMLHttpRequest',
  };
}

// Fetch consolidated bills for the given pay period.
// The listing API does not support pay_period filtering, so we:
//   1. Page through all driver_settlement listings
//   2. Filter candidates by billDate window (pay_period_end ± reasonable window)
//   3. Fetch each candidate individually to confirm pay_period_start/end match
async function getConsolidatedBills(payPeriodStart, payPeriodEnd) {
  const headers = await apiHeaders();

  // Collect all driver_settlement summaries.
  // inConsolidatedBillTypes param is required — without it the API omits payPeriodStart/End.
  let allSettlements = [];
  let page = 0;
  while (true) {
    let res;
    try {
      res = await axios.get(`${BASE_URL}/api/v1/consolidated_bills`, {
        headers,
        params: {
          limit: 200,
          offset: page * 200,
          inConsolidatedBillTypes: 'driver_settlement',
        },
      });
    } catch (err) {
      const status = err.response?.status;
      const body   = JSON.stringify(err.response?.data ?? {});
      throw new Error(`[RoseRocket] GET consolidated_bills page ${page} failed (${status}): ${body}`);
    }

    const settlements = res.data?.data?.settlements ?? [];
    allSettlements = allSettlements.concat(settlements);

    if (settlements.length < 200) break;
    page++;
  }

  // Include bills whose pay period overlaps with the user's range.
  // Overlap condition: bill starts before range ends AND bill ends after range starts.
  const candidates = allSettlements.filter(s => {
    if (!s.payPeriodStart || !s.payPeriodEnd) return false;
    return s.payPeriodStart <= payPeriodEnd && s.payPeriodEnd >= payPeriodStart;
  });

  // Fetch each candidate individually to get the full sub-bill structure
  const results = [];
  for (const candidate of candidates) {
    let res;
    try {
      res = await axios.get(`${BASE_URL}/api/v1/consolidated_bills/${candidate.id}`, { headers });
    } catch (err) {
      console.warn(`[RoseRocket] Could not fetch bill ${candidate.id} — skipping`);
      continue;
    }
    const cb = res.data?.data?.consolidated_bill;
    if (!cb) continue;
    results.push(cb);
  }

  console.log(`[RoseRocket] Fetched ${results.length} consolidated bills for ${payPeriodStart} → ${payPeriodEnd} (total settlements: ${allSettlements.length}, in date window: ${candidates.length})`);
  return results;
}

// Fetch the full sub-bill object (items + manifest fields, etc.)
// The consolidated bill GET does NOT return sub-bill items; a separate /bills/{id} call is needed.
async function getSubBill(subBillId) {
  const headers = await apiHeaders();
  try {
    const res = await axios.get(`${BASE_URL}/api/v1/bills/${subBillId}`, { headers });
    return res.data?.data?.bill ?? null;
  } catch (err) {
    const status = err.response?.status;
    console.warn(`[RoseRocket] Could not fetch sub-bill ${subBillId} (${status}) — treating as empty`);
    return null;
  }
}

async function getSubBillItems(subBillId) {
  const bill = await getSubBill(subBillId);
  return bill?.items ?? [];
}

// Update a consolidated bill (PUT full payload back).
// billData is the full consolidated_bill object returned by GET /consolidated_bills/{id},
// with bill.bills[*].bill_items already mutated to include new charges.
async function updateConsolidatedBill(billId, billData, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would PUT /api/v1/consolidated_bills/${billId}`);
    return;
  }
  const headers = await apiHeaders();

  // Keys present in GET /bills/{id} items that the API rejects when null (reference UUIDs).
  const ITEM_EXTRA_KEYS = new Set([
    'deleted_at', 'partner_carrier_id', 'calendar_event_id', 'fuel_card_purchase_id',
    'driver_pay_contract_recurring_payment_id', 'master_trip_id',
    'order_id', 'order_full_id', 'customer_name',
  ]);
  const cleanItem = item => {
    const out = {};
    for (const [k, v] of Object.entries(item)) if (!ITEM_EXTRA_KEYS.has(k)) out[k] = v;
    return out;
  };

  // bills_to_update: simplified format matching Chrome's successful PUT payload.
  // Existing items (have an id) are cleaned of null-UUID keys; new items pass through as-is.
  const bills_to_update = (billData.bills ?? []).map(b => ({
    bill_id:    b.id,
    bill_type:  b.type,
    bill_items: (b.bill_items ?? []).map(item => item.id ? cleanItem(item) : item),
    is_tax_on:  b.is_tax_on ?? true,
  }));

  // Mirror Chrome's payload exactly: { data: <full bill>, ...same fields at root..., bills_to_update }
  const payload = {
    data: billData,
    ...billData,
    bills_to_update,
    isNewStatement: false,
    isDriverType:   true,
    isCarrierType:  false,
  };

  try {
    await axios.put(`${BASE_URL}/api/v1/consolidated_bills/${billId}`, payload, { headers });
    console.log(`[RoseRocket] Updated consolidated bill ${billId}`);
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data ?? {});
    throw new Error(`[RoseRocket] PUT consolidated_bills/${billId} failed (${status}): ${body}`);
  }
}

module.exports = { getConsolidatedBills, getSubBill, getSubBillItems, updateConsolidatedBill };
