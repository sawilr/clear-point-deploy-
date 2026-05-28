// ============================================================================
// V15 stub — knowledge entries are now inlined inside customerServiceEngine.ts.
// This file is preserved as a placeholder so any historical imports continue
// to compile. The previous 30+ knowledge entries were superseded by the V15
// state-machine + inline response copy. If a future wave reintroduces a
// retrieval layer, populate `customerServiceKnowledge` below.
// ============================================================================

export interface KnowledgeEntry {
  id: string;
  intent: string;
  subtype?: string;
  keywords: string[];
  response: string;
  responseEs: string;
  chips?: string[];
  chipsEs?: string[];
  needsFollowUp?: boolean;
  source?: string;
}

export const customerServiceKnowledge: KnowledgeEntry[] = [];

export default customerServiceKnowledge;
