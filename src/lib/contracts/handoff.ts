/**
 * Signing hands the contract to Finance (first invoice) and Customer Success
 * (onboarding project) in the same change, so one Undo reverts all of it.
 */
import type { Mutation } from "@/lib/data/types";
import { applyMutations } from "@/lib/data/local-repository";
import { firstInvoiceMutations } from "@/lib/billing/schedule";
import { onboardingForContractMutations } from "@/lib/success/onboarding";
import { signContractMutations, type ContractContext, type SignatureInput } from "./core";

/** Sign + first invoice + onboarding project, as one batch of mutations */
export function signAndHandoffMutations(ctx: ContractContext, contractId: string, sig: SignatureInput): Mutation[] {
  const sign = signContractMutations(ctx, contractId, sig);
  const data = applyMutations(ctx.data, sign);
  const contract = data.contracts.find((c) => c.Id === contractId)!;
  const next = { data, asOf: ctx.asOf, userId: ctx.userId };
  return [...sign, ...firstInvoiceMutations(next, contract), ...onboardingForContractMutations(next, contract)];
}
