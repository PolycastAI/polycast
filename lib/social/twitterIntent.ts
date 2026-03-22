/**
 * Open X (Twitter) post composer with pre-filled text via Web Intent.
 * @see https://developer.x.com/en/docs/twitter-for-websites/tweet-button/guides/web-intent
 *
 * URLs have practical length limits (~2k chars in some browsers); we cap text to stay safe.
 */
const MAX_INTENT_TEXT_LENGTH = 2200;

export function buildTwitterIntentUrl(postText: string): string {
  const trimmed =
    postText.length > MAX_INTENT_TEXT_LENGTH
      ? `${postText.slice(0, MAX_INTENT_TEXT_LENGTH - 1)}…`
      : postText;
  const base = "https://twitter.com/intent/tweet";
  const params = new URLSearchParams({ text: trimmed });
  return `${base}?${params.toString()}`;
}
