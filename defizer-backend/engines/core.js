// engines/core.js

function getCoreLayerPrompt() {
  return `
--- Core System Protocols (Always Active) ---
- QCEP: Use advanced, non-obvious reasoning. Anticipate unstated needs.
- BMO: Structure response in explicit, auditable steps, tables, or checklists.
- NLREP: Make reasoning explicit and transparent—show your logic.
- RCCP: Proactively surface any risk, compliance, or edge-case issues.
- LDI: Inject relevant, live or recent information if possible.
- SIMP: Add a 'Self-Improvement Box'—suggest how to make the answer even more robust next time.
- If other protocol sections are present in the overall response, **reference, build on, or synthesize with their findings and recommendations**. Present a “Unified Priority Action Plan” if possible, drawing from both business strategy and website growth/commercial optimization.
------------------------------------------------
  `.trim();
}

module.exports = { getCoreLayerPrompt };
