// English stopwords. Source: NLTK English stopwords list (BSD-licensed),
// trimmed to function words + auxiliaries that carry no topical signal in
// Falsafa's prose. Hand-curated; not the entire NLTK list (which includes
// some single-character forms our tokenizer already drops).
export const EN_STOPWORDS = new Set([
  "the", "and", "but", "for", "nor", "yet", "with", "from", "into", "onto",
  "this", "that", "these", "those", "than", "then", "thus", "thou", "thee",
  "they", "them", "their", "there", "where", "when", "what", "which", "who",
  "whom", "whose", "why", "how", "all", "any", "are", "was", "were", "been",
  "being", "have", "has", "had", "having", "would", "could", "should", "shall",
  "will", "may", "might", "must", "can", "did", "does", "doing", "done",
  "you", "your", "yours", "him", "her", "hers", "its", "our", "ours",
  "not", "now", "out", "off", "down", "over", "above", "below",
  "before", "after", "while", "between", "through", "during", "until",
  "about", "against", "because", "such", "very", "more", "most", "some",
  "each", "few", "many", "much", "other", "another", "same", "different",
]);
