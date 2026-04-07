/**
 * textCleaners.ts
 * ────────────────
 * Frontend text cleaning utilities for LLM responses.
 * Strips markdown artifacts, meta phrases, and normalizes text
 * before rendering in the UI.
 */

/**
 * Strip markdown formatting from text, preserving content.
 * Handles: **bold**, __bold__, *italic*, _italic_, ~~strike~~,
 * `code`, ```blocks```, # headers, [links](url), > blockquotes
 */
export function cleanMarkdown(text: string): string {
  if (!text) return text;

  let cleaned = text;

  // Code blocks: ```...``` → content
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) =>
    match.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
  );

  // Images: ![alt](url) → alt
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Links: [text](url) → text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Bold: **text** → text
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');

  // Bold: __text__ → text
  cleaned = cleaned.replace(/__(.+?)__/g, '$1');

  // Strikethrough: ~~text~~ → text
  cleaned = cleaned.replace(/~~(.+?)~~/g, '$1');

  // Inline code: `text` → text
  cleaned = cleaned.replace(/`([^`]+?)`/g, '$1');

  // Italic: *text* → text (careful not to remove bullet points)
  cleaned = cleaned.replace(/(?<!\w)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');

  // Italic: _text_ → text
  cleaned = cleaned.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1');

  // Headers: # Title → Title
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Horizontal rules: --- or *** or ___
  cleaned = cleaned.replace(/^\s*[-*_]{3,}\s*$/gm, '');

  // Blockquotes: > text → text
  cleaned = cleaned.replace(/^\s*>\s?/gm, '');

  // Orphan asterisks
  cleaned = cleaned.replace(/(?<!\w)\*{1,2}(?!\w)/g, '');

  return cleaned;
}

/**
 * Remove meta/filler phrases that add no conversational value.
 * These are phrases like "Sure!", "I understand now...", "Great question!" etc.
 */
export function cleanMetaPhrases(text: string): string {
  if (!text) return text;

  let cleaned = text.trim();

  const metaPatterns = [
    /^Sure[,!.]?\s*/i,
    /^Of course[,!.]?\s*/i,
    /^Absolutely[,!.]?\s*/i,
    /^Great question[,!.]?\s*/i,
    /^Good question[,!.]?\s*/i,
    /^That's a great question[,!.]?\s*/i,
    /^That's a good question[,!.]?\s*/i,
    /^Certainly[,!.]?\s*/i,
    /^I'd be happy to help[,!.]?\s*/i,
    /^I'd be glad to help[,!.]?\s*/i,
    /^I'd love to help[,!.]?\s*/i,
    /^Let me help you with that[,!.]?\s*/i,
    /^I understand (?:now|your|what|that)[^.!?]*[.!?]?\s*/i,
    /^I see (?:what|that|you)[^.!?]*[.!?]?\s*/i,
    /^You'?re asking (?:about|for|me|if|whether)[^.!?]*[.!?]?\s*/i,
    /^You want (?:to know|me to)[^.!?]*[.!?]?\s*/i,
    /^So,? (?:basically|essentially|you'?re asking)[^.!?]*[.!?]?\s*/i,
    /^To answer your question[,:]?\s*/i,
    /^Here's (?:the answer|my answer|what I think)[,:]?\s*/i,
    /^(?:Okay|Ok),?\s+(?:so|let me)[,\s]*/i,
    /^As an AI(?:\s+(?:language\s+)?model)?[,.]\s*/i,
    /^As a language model[,.]\s*/i,
    /^As your AI assistant[,.]\s*/i,
  ];

  for (const pattern of metaPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Re-capitalize first character
  if (cleaned && /^[a-z]/.test(cleaned)) {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

/**
 * Full response cleaning pipeline.
 * Apply this to any LLM text before rendering in the UI.
 */
export function cleanResponse(text: string): string {
  if (!text?.trim()) return text;

  let cleaned = text;
  cleaned = cleanMarkdown(cleaned);
  cleaned = cleanMetaPhrases(cleaned);

  // Collapse 3+ newlines to 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Remove trailing whitespace per line
  cleaned = cleaned.replace(/[ \t]+$/gm, '');

  return cleaned.trim();
}
