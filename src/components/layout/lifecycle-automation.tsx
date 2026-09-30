"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/data/store";
import { contractStatusMutations } from "@/lib/contracts/core";
import { billingMutations } from "@/lib/billing";
import { renewalMutations } from "@/lib/success/renewals";

/**
 * Keeps records in step with the time-travel date: contracts activate and
 * expire, scheduled invoices are issued and overdue ones flagged, and renewal
 * opportunities open 120 days before a contract ends. Every step is
 * idempotent, so it runs whenever the date or the data changes.
 */
export function LifecycleAutomation() {
  const { ready, allData, asOf, asOfISO, commit } = useStore();
  const running = useRef(false);
  useEffect(() => {
    if (!ready || running.current) return;
    running.current = true;
    try {
      const contracts = contractStatusMutations(allData, asOf);
      const billing = billingMutations(allData, asOf);
      const renewals = renewalMutations(allData, asOf);
      const all = [...contracts, ...billing, ...renewals];
      if (all.length) commit(all, { silent: true });
    } finally {
      running.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asOfISO stands in for asOf
  }, [ready, allData, asOfISO, commit]);
  return null;
}
