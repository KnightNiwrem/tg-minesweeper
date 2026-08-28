// Tiny typed builders for rich-message blocks. Buttons here live in the
// message BODY (rich message blocks) — this bot never uses reply_markup.

import type { InputRichBlock, RichMessageButton, RichText } from "grammy/types";

export function para(text: RichText): InputRichBlock {
  return { type: "paragraph", text };
}

export function heading(
  text: RichText,
  size: 1 | 2 | 3 | 4 | 5 | 6 = 3,
): InputRichBlock {
  return { type: "heading", text, size };
}

export function buttonsRow(
  buttons: RichMessageButton[],
  align: "left" | "center" | "right" = "center",
): InputRichBlock {
  return { type: "buttons", buttons, align };
}

export function cbBtn(
  text: string,
  callback_data: string,
  style?: "danger" | "success" | "primary" | "link",
): RichMessageButton {
  return style === undefined
    ? { text, callback_data }
    : { text, callback_data, style };
}

export function banner(text: string): InputRichBlock {
  return {
    type: "blockquote",
    blocks: [{ type: "paragraph", text: { type: "bold", text } }],
  };
}
