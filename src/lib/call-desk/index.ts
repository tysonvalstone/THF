/**
 * Call Desk: pre-call briefs and AI Notes. Pure helpers (no React).
 *
 * Demo Mode hooks (for a guided walkthrough):
 *
 *   scheduleCallMutations(ctx: CallContext, input: ScheduleCallInput)
 *     → { callId: string; mutations: Mutation[] }
 *   simulatedTranscript(call: Call, data: Pick<DataSnapshot, "accounts" | "contacts" | "opportunities">)
 *     → TranscriptLine[]            // { speaker, text, atSec }
 *   notesFromTranscript(call: Call, transcript: TranscriptLine[], repNotes: string, data: NotesData, opts?)
 *     → CallNotes                   // rules-based AI Notes, incl. followUpEmail
 *   suggestedUpdates(call: Call, notes: CallNotes, data: NotesData)
 *     → SuggestedUpdate[]           // stage, close date, economic buyer, next step, locations
 *   saveCallMutations(ctx: CallContext, call: Call, notes: CallNotes, confirmedUpdates: SuggestedUpdate[])
 *     → Mutation[]                  // Call → Completed + notes, Tasks from next steps, confirmed updates
 *   buildBrief(call: Call, data: DataSnapshot, opts?: { asOf?: Date }) → CallBrief | null
 *
 * CallContext is { data: DataSnapshot; asOf: Date; userId: string }.
 * Commit mutations with useCrud().run(mutations, message).
 */
export * from "./types";
export * from "./time";
export * from "./transcript";
export * from "./notes";
export * from "./mutations";
export * from "./brief";
export * from "./search";
export type { TranscriptLine } from "@/lib/callScripts";
export * from "./ai";
