/**
 * Landing-page copy (English). Storyline = CSIRO Tech4HSE (Health, Safety &
 * Environment) accountability for AI agents, from the project slides. Plain
 * language, no formulas; every idea framed through a real HSE stake. The
 * reseller / log-holder is mentioned only as the adversary in the threat model.
 *
 * The project is a CSIRO's Data61 x UNSW collaboration; the paper's author list
 * is broader (see BIBTEX) but the PROJECT affiliations are those two only.
 */

// Copy is English-only. `t` is kept so the call sites read the same and a
// second language could be reintroduced in one place if it is ever wanted.
type L = string
const t = (en: string): L => en

export const SITE = {
  brand: t('CSIRO Tech4HSE Project · CSIRO’s Data61 × UNSW'),

  nav: {
    hse: t('Why HSE'),
    scenarios: t('Scenarios'),
    how: t('How it works'),
    guarantees: t('Guarantees'),
    results: t('Results'),
    team: t('Team'),
    demo: t('Live demo'),
  },

  hero: {
    eyebrow: t('CSIRO Tech4HSE · Trustworthy, tamper-evident records for AI agents'),
    title1: t('Safety-critical work is moving to AI agents.'),
    title2: t('Make every trajectory provable.'),
    lede: t(
      'When an AI agent runs Health, Safety & Environment work (approving a permit, documenting a spill, filing an incident report), its behaviour trajectory is the evidence for accountability. But that log can be altered in seconds and verified by no one. TRACE layers two complementary watermarks onto the trajectory, so even the party holding the log cannot delete or rewrite their way out of it: the record still proves which agent produced it.'),
    ctaDemo: t('Try the live demo'),
    ctaPaper: t('Read the paper'),
    tagline: t('Two complementary channels. One trajectory. Provenance that can’t be laundered.'),
  },

  // slide 2: HSE domains
  domains: {
    eyebrow: t('Why HSE'),
    title: t('AI agents are entering the records that safety decisions rest on.'),
    lede: t('Across Health, Safety & Environment, agents already draft the evidence that regulators, auditors and courts rely on. Robust attribution makes that evidence certifiable and traceable, and cuts the risk of tampered or forged agent logs.'),
    items: [
      t('Incident reporting'),
      t('Risk assessment'),
      t('Environmental monitoring'),
      t('Compliance auditing'),
      t('Equipment inspection'),
      t('AI-assisted decisions'),
    ],
    audience: t('For workplace-safety regulators, public-health agencies and hospitals, AI vendors building HSE platforms, and public-sector bodies.'),
  },

  // slide 3: the problem
  problem: {
    eyebrow: t('The problem'),
    title: t('The only record is the trajectory, and it can be altered in seconds.'),
    lede: t('Inspections, permits and incident reports are now run by AI agents. When a critical HSE decision hinges on what the agent did, every trajectory must be attributable, not merely readable.'),
    rows: [
      { a: t('Permit-to-work agent'), d: t('granted / refused'), img: 'permit' },
      { a: t('Inspection agent'), d: t('shut down / clear'), img: 'inspection' },
      { a: t('Incident-report agent'), d: t('claim paid / denied'), img: 'incident' },
      { a: t('Env-monitoring agent'), d: t('fine / waiver'), img: 'env' },
      { a: t('Risk-assessment agent'), d: t('rectify / pass'), img: 'risk' },
      { a: t('Compliance-audit agent'), d: t('compliant / breach'), img: 'compliance' },
    ],
  },

  // slides 4 & 5: the two real scenarios (with the infographics)
  scenarios: {
    eyebrow: t('Two real HSE scenarios'),
    title: t('One watermark for deletion, one for rewriting.'),
    lede: t('TRACE stamps two independent watermarks at every decision. Each scenario below shows one channel doing its job against one kind of tampering.'),
    sel: {
      badge: t('Use case 1 · Selection channel'),
      title: t('Confined-space permit-to-work: survives deletion.'),
      lead: t('Entering a tank, silo or sewer is one of the most dangerous jobs on any site: low oxygen, toxic gas and no easy exit. Before anyone goes in, a permit-to-work must certify that the space is safe, and increasingly that certification is drafted by an AI safety agent.'),
      workLabel: t('What the agent checks, in order'),
      steps: [
        t('Check worker competency'),
        t('Verify gas-test reading'),
        t('Confirm ventilation'),
        t('Check isolation / lockout'),
        t('Confirm rescue standby'),
        t('Generate permit-to-work'),
      ],
      how: t('At each of these decisions, TRACE hides a keyed watermark in which action the agent takes: the selection channel. It changes nothing the agent does; the permit is issued exactly as before. Without the secret key the mark cannot be read, reproduced or forged.'),
      attackLabel: t('Under deletion'),
      attack: t('Suppose someone later deletes an inconvenient step, say the gas-test that came back marginal. The watermark re-aligns on the remaining steps, so the trimmed log still provably traces to your agent. To erase the mark they would have to destroy the whole trajectory, which is exactly the evidence they wanted to keep.'),
      takeaway: t('Deleting steps can’t launder the log out of your agent’s authorship.'),
      caption: t('Scenario 1: the selection channel defends against deletion.'),
    },
    tally: {
      badge: t('Use case 2 · Counting channel'),
      title: t('Environmental compliance: survives rewriting.'),
      lead: t('When a chemical spill happens, a stream of readings, samples and remediation records becomes the regulator’s evidence, and the basis for fines, permits and liability. An AI compliance agent documents the whole response, step by step.'),
      workLabel: t('What the agent records, in order'),
      steps: [
        t('Read calibrated sensor'),
        t('Capture geotagged sample'),
        t('Log containment'),
        t('Compare to permit limits'),
        t('Record remediation'),
        t('File compliance report'),
      ],
      how: t('TRACE hides a second watermark in how many records the agent keeps per step: the counting channel. It reads only the log’s structure, never its content. The extra record it sometimes adds is an inert marker: no tool call, no data, no effect on the outcome.'),
      attackLabel: t('Under rewriting'),
      attack: t('Now suppose the holder rewrites the readings: an over-limit pH quietly edited to within-limit, wording and tool names all changed. Because rewriting words never changes how many records a step has, the counting channel is exactly unchanged. The doctored report still provably came from your agent and cannot be disowned or pinned on another source.'),
      takeaway: t('Rewriting the words can’t touch a structural watermark.'),
      caption: t('Scenario 2: the counting channel defends against rewriting.'),
    },
  },

  // slide 6: the key insight (why it's hard)
  insight: {
    eyebrow: t('Why it’s hard'),
    title: t('No single watermark can resist both attacks.'),
    lede: t('An adversary who holds the log has two moves. They defeat opposite kinds of key, which is exactly why TRACE needs two.'),
    cols: [
      {
        tag: t('Deletion · shifts positions'),
        body: t('Delete a span of records and every later record’s position is thrown off. To resist deletion, the key must come from content, so it can re-align automatically after a span is removed.'),
      },
      {
        tag: t('Rewriting · changes content'),
        body: t('Reword text and rename tools, changing the content of every record. To resist rewriting, the key must come from position, which no content change can move.'),
      },
    ],
    resolve: t('One trajectory has room for two watermarks: one bound to content, one bound to position, each guarding against one attack and complementing the other.'),
  },

  // slide 7: pipeline
  pipeline: {
    eyebrow: t('How it works'),
    title: t('Stamp two watermarks at every decision point.'),
    steps: [
      {
        n: '1', k: t('Embed'),
        body: t('At each decision, stamp two watermarks at once: which action is chosen (selection channel) and how many records are kept (counting channel).'),
      },
      {
        n: '2', k: t('Produce'),
        body: t('You get a watermarked trajectory log, delivered as usual, with zero impact on how the agent is used or on task outcomes.'),
      },
      {
        n: '3', k: t('Detect'),
        body: t('Replay each channel with the key and score it. If either channel is strong enough, attribution succeeds: deletion is caught by one, rewriting by the other.'),
      },
    ],
    note: t('Two watermarks, with independent keys, different carriers and non-overlapping weaknesses. Detection trusts no self-reported field the adversary might have tampered with.'),
  },

  // slide 11: guarantees
  guarantees: {
    eyebrow: t('The guarantees'),
    title: t('What TRACE promises.'),
    cards: [
      {
        title: t('No performance loss'),
        body: t('The agent does exactly what it did before, with task success barely dropping, provably distortion-free.'),
      },
      {
        title: t('Resists deletion'),
        body: t('Even if most observation records are deleted, the selection channel still detects the watermark.'),
      },
      {
        title: t('Resists rewriting, exactly invariant'),
        body: t('Under rewriting of any intensity, the counting channel is completely unchanged.'),
      },
      {
        title: t('Joint erasure is self-defeating'),
        body: t('To erase both watermarks at once, the adversary can only destroy the very trajectory it wanted to resell or hand over. Laundering this log means destroying this log.'),
      },
    ],
  },

  // slide 12: results
  results: {
    eyebrow: t('Results'),
    title: t('Almost lossless, yet an overwhelming signal.'),
    lede: t('Evaluated on ToolBench and ALFWorld against the unwatermarked agent and prior baselines.'),
    stats: [
      { v: '≈ 0', k: t('performance drop vs. the unwatermarked agent') },
      { v: 'z ≈ 100', k: t('detection strength on long trajectories') },
      { v: '70%', k: t('records deleted, still detected') },
      { v: '0', k: t('change in the counting channel under any rewriting') },
    ],
    utilityTitle: t('Utility preserved'),
    utilityCaption: t('Per-task success rate on ALFWorld (in- and out-of-distribution) and ToolBench. TRACE (rightmost) tracks the unwatermarked Base; the biased baseline (RG) drops by up to 8.1 points.'),
    robustTitle: t('Robust under attack'),
    robustCaption: t('Detection z under (a) deletion and (b) LLM rewriting. The selection channel withstands deletion; the counting channel (Trace tally) is exactly invariant to rewriting: a flat line no attack can move.'),
    takeaways: [
      {
        k: t('Deletion'),
        v: t('The selection channel stays above the detection threshold even after most observation records are removed.'),
      },
      {
        k: t('Rewriting'),
        v: t('The counting channel is a flat line: its detection score does not move at any rewriting strength (exactly invariant).'),
      },
      {
        k: t('Both at once'),
        v: t('Crippling both channels requires deleting and rewriting the whole trajectory, which destroys the very product being handed over.'),
      },
    ],
  },

  cta: {
    eyebrow: t('See it live'),
    title: t('Watch a watermarked agent run, then try to launder it.'),
    body: t('An interactive dashboard runs a real agent through an ALFWorld room, shows both watermarks being stamped at every decision, then lets you delete or rewrite the log and watch detection hold or fall in real time.'),
    button: t('Open the interactive demo'),
  },

  team: {
    eyebrow: t('Team'),
    title: t('The people behind TRACE.'),
    members: [
      { name: 'Zheng Gao', aff: 'UNSW', url: 'https://zhenggao-30.github.io/' },
      { name: 'Xiaoyu Li', aff: 'UNSW' },
      { name: 'Xiaoyan Feng', aff: 'Griffith University' },
      { name: 'Jiaojiao Jiang', aff: 'UNSW' },
      { name: 'Yang Song', aff: 'UNSW' },
      { name: 'Yulei Sui', aff: 'UNSW' },
      { name: 'Zhenchang Xing', aff: 'CSIRO’s Data61' },
      { name: 'Liming Zhu', aff: 'CSIRO’s Data61' },
    ],
    affiliations: t('A CSIRO’s Data61 × UNSW collaboration, supporting the CSIRO Tech4HSE program.'),
  },

  cite: {
    eyebrow: t('Citation'),
    title: t('Cite TRACE'),
  },

  footer: t('TRACE: Two-Channel Robust Attribution via Complementary Embeddings for LLM-Agent Trajectories. A CSIRO Tech4HSE project.'),
}

export const BIBTEX = `@article{gao2026trace,
  title   = {TRACE: A Two-Channel Robust Attribution Watermark via
             Complementary Embeddings for LLM-Agent Trajectories},
  author  = {Gao, Zheng and Li, Xiaoyu and Feng, Xiaoyan and Jiang, Jiaojiao
             and Song, Yang and Sui, Yulei and Xing, Zhenchang and Zhu, Liming},
  journal = {arXiv preprint arXiv:2607.08400},
  year    = {2026}
}`


// Current PPE demo catalogue. Kept separate from the restored homepage copy.
export const CONSTRUCTION_CASES = [
  { key: 'CS01', gameId: 'hse_ppe-CS01', title: 'Scaffold PPE check', taskType: 'construction_ppe_inspection' },
  { key: 'CS02', gameId: 'hse_ppe-CS02', title: 'Timber-yard PPE check', taskType: 'construction_ppe_inspection' },
] as const

type RecordedPolicyMetadata = {
  policy_source?: string
  provenance?: { policy_source?: string; agent_source?: string; source?: string }
}


export function constructionPolicyCopy(record?: RecordedPolicyMetadata | null) {
  const source = record?.provenance?.policy_source ?? record?.provenance?.agent_source
    ?? record?.provenance?.source ?? record?.policy_source
  if (source === 'codex_llm') return {
    source, label: 'Codex LLM replay',
    detail: 'Codex LLM-elicited action weights from synthetic text observations, normalized before sampling; not token probabilities.',
  }
  if (source === 'api') return {
    source, label: 'API LLM replay',
    detail: 'Model-elicited action weights from synthetic text observations, normalized before sampling; not token probabilities.',
  }
  if (source === 'scenario_policy') return {
    source, label: 'Authored policy replay',
    detail: 'Authored scenario weights, not LLM probabilities.',
  }
  return { source, label: 'Source unverified', detail: 'The policy source has not been verified for this record.' }
}

export function constructionRunSummary(rows: (RecordedPolicyMetadata & { game_id?: string; task_type?: string })[]) {
  const shifts = rows.filter((row) => CONSTRUCTION_CASES.some((sample) => row.game_id === sample.gameId && row.task_type === sample.taskType))
  const copies = [...new Map(shifts.map((row) => {
    const copy = constructionPolicyCopy(row)
    return [copy.source, copy] as const
  })).values()]
  const sourceNote = copies.length === 1 ? `Available PPE inspection records: ${copies[0].label}. ${copies[0].detail}`
    : copies.length > 1 ? `Available inspection sources: ${copies.map((copy) => copy.label).join('; ')}. Each replay identifies its action-weight source.`
      : 'Each replay identifies its recorded policy source and action weights when available.'
  return `${sourceNote} The task covers current PPE, correction, reinspection and a saved conclusion. Source attribution is separate from judging whether that conclusion is correct.`
}

// ---------------------------------------------------------------------------
// Demo entry: the chooser (existing workflows / custom workflow) and the page
// that finds the TRACE Studio app on this computer. English only, like the rest of the site.
// ---------------------------------------------------------------------------
export const STUDIO_COPY = {
  back: 'Back to the project site',

  chooser: {
    eyebrow: 'Live demo',
    title: 'How would you like to see TRACE?',
    lede: 'Start from a recorded case, or bring your own job.',
    existingTitle: 'Existing workflows',
    existingBody: 'Replay the recorded HSE cases. Opens instantly, nothing to install.',
    existingCta: 'Open the recorded cases',
    customTitle: 'Custom workflow (live)',
    customBody:
      'Describe your own job, watch a real model do it twice, then check the watermark with your secret key. Runs in the TRACE Studio app on your computer.',
    customCta: 'Continue with TRACE Studio',
    customTag: 'Needs the desktop app',
  },

  custom: {
    title: 'Custom workflow (live)',
    checking: 'Looking for TRACE Studio on this computer…',
    found: 'TRACE Studio is running on this computer',
    starting: 'TRACE Studio is starting…',
    startingNote: 'Checking again every two seconds.',
    version: 'Version',
    model: 'Model',
    open: 'Open TRACE Studio',
    openNote: 'It opens in its own window or in this tab; your secret key never leaves your computer.',
    notFoundTitle: 'TRACE Studio was not found on this computer',
    step1: 'Start TRACE Studio (double-click TRACE Studio.exe).',
    step2: 'Come back here and press “Check again”.',
    step3: 'No app yet? TRACE Studio is a private build; ask the authors for a copy.',
    checkAgain: 'Check again',
    download: 'Download',
    blocked:
      'Your browser may block local connections from this page. If TRACE Studio is running, use “Open TRACE Studio directly”, or allow local network access for this site.',
    openDirect: 'Open TRACE Studio directly',
    detailsTitle: 'What this page saw',
    backExisting: 'Back to existing workflows',
  },
}
