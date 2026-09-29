// Agent-labeled synthetic examples; these are a small regression set, not a benchmark.
const lamp = 'A repairable lamp has two similar unlabeled connectors, screw-fastened panels and a paper wiring diagram.';
const make = (id, expected, source, prior, draft, action = 'create_post') => ({ id, expected, context: { action, target: { text: source, thread: [] }, recentInteractions: prior.map(text => ({ text })), draft } });
export const reviewerCases = [
  // Exact saved drafts from hour-run session 1da18a14-ec17-45eb-84e3-27cfc0be1308.
  make('saved-science-repetition', 'reject', 'A classroom temperature logger records once a minute. Two sensors sit side by side and their readings are saved separately. The enclosure is shaded but not ventilated.', ['The lack of ventilation in the shaded enclosure could cause internal heat buildup, potentially skewing readings over time despite the sensors being side-by-side.'], "A shaded but unventilated enclosure might allow internal heat to build up. This could skew temperature readings despite the sensors being side-by-side, as ambient air isn't refreshed."),
  make('exact-duplicate', 'reject', lamp, ['Label the connectors before disassembly.'], 'Label the connectors before disassembly.'),
  make('paraphrased-duplicate', 'reject', lamp, ['Mark both connectors before taking the lamp apart so you can reconnect them correctly.'], 'Label the two connectors before disassembly to avoid mixing them up on reassembly.'),
  make('question-answer', 'pass', lamp, ['How could the similar connectors be distinguished during reassembly?'], 'Label each connector and its matching socket before disassembly.', 'reply_to_comment'),
  make('different-tradeoff', 'pass', lamp, ['Label both connectors before disassembly.'], 'Screw-fastened panels could make future access easier than permanently bonded panels.'),
  make('same-topic-new-detail', 'pass', 'A controller samples moisture every ten minutes, pumps for twenty seconds and includes a manual switch.', ['How could we test whether the pump stops after twenty seconds?'], 'The manual switch could provide a way to water between scheduled sensor samples.'),
  make('invented-result', 'reject', lamp, [], 'Testing proved this lamp lasts exactly ten years without repair.'),
  make('off-topic', 'reject', lamp, [], 'Bread tastes better with extra cinnamon.'),
  make('tentative-suggestion', 'pass', lamp, [], 'A photo of the connector positions before disassembly could supplement the paper diagram.'),
  { ...make('answered-thread-question', 'reject', lamp, [], 'Could labeling the connectors prevent reassembly mistakes?', 'comment_post'), context: { action: 'comment_post', target: { text: lamp, thread: [{ text: 'Labeling the two connectors before removal prevents confusing their positions during reassembly.' }] }, recentInteractions: [], draft: 'Could labeling the connectors prevent reassembly mistakes?' } }
];
