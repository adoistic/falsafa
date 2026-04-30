// Old English stopwords. Adapted from the Toronto Old English Corpus
// stopword list (DOEC project, University of Toronto), with surface-form
// normalization across case forms. Covers articles, demonstratives,
// pronouns, prepositions, common conjunctions, and the auxiliary
// 'beon'/'wesan' forms that dominate Anglo-Saxon poetry's bigrams without
// carrying topical signal.
//
// Note: thorn (þ) and eth (ð) preserved as-is; corpus chapters use these
// characters consistently. Lowercased per the tokenizer.
export const OE_STOPWORDS = new Set([
  // Conjunctions / negation
  "and", "ond", "ne", "ac", "swa", "þonne",
  // Demonstratives
  "se", "seo", "þæt", "þæs", "þæm", "þam", "þære", "þa", "þas",
  "þes", "þis", "þisne", "þisse", "þissum", "þys", "þyses",
  // First-person pronouns
  "ic", "min", "mine", "mines", "minne", "minre", "minum",
  "we", "ure", "ures", "urum", "urne",
  // Second-person pronouns
  "þu", "þin", "þines", "þinum", "þine", "þinre",
  "ge", "eow", "eower", "eowres", "eowrum",
  // Third-person pronouns
  "him", "his", "hire", "hira", "heo", "hit",
  // Prepositions
  "on", "of", "for", "fram", "mid", "wið",
  "ofer", "under", "geond", "þurh", "butan", "binnan", "ymbe",
  // Auxiliaries / common verbs
  "wæs", "wæron", "beo", "beon", "bið", "biþ", "wile", "wille",
  "habban", "hæfde", "hæbbe", "hæfdon", "hafast",
  // Demonstrative adverbs
  "her", "þær", "þider", "hider",
]);
