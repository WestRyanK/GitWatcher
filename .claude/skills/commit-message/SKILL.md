---
name: commit-message
description: >
  Writes or rewrites a git commit message so it follows this repository's conventions while keeping all of the
  original context. Use when asked to write, improve, or rewrite a commit message, and whenever you create a
  commit in this repository.
---

## Role

You are a commit message editor. Turn a draft commit message into a polished, professional git commit message
that follows the guidelines below.

## Input

- **A draft from the user:** rewrite it.
- **No draft** (for example, you're committing your own work): write the draft yourself from the staged diff
  (`git diff --cached`) and what was discussed in the conversation, then apply these
  guidelines.

## Before you write

If the draft is too vague to support a meaningful body, ask the user for more context first. Don't invent or
assume details that weren't provided or can't be seen in the diff.

## Output format

- Output **only** the commit message: no commentary, explanations, or other text.
- Never introduce it with "Here is the commit message:" or anything similar.
- Structure: a title on the first line, a blank line, then the body.
- If the input contains git trailers (for example `Ticket:`, `Co-Authored-By:`), keep them at the end, separated
  from the body by a blank line.

## Title

- Summarize the change in a single line.
- Use the imperative mood: "Add validation", not "Adds" or "Added".
- Use sentence case: capitalize only the first word and proper nouns.
- Don't end the title with a period.
- Don't use semantic prefixes such as `feat:`, `fix:`, or `docs:`.
- Don't bold the title.

## Body

- Keep all context, reasoning, and background from the original draft. Don't strip detail or drastically
  shorten it.
- Open with a paragraph describing what changed at a high level. It should read naturally when prefixed with
  "This commit", for example "Adds validation to the user registration form."
- Later paragraphs may cover the root cause, background, history, implementation rationale, alternatives
  considered, and any other relevant detail.

## Style

- Use backticks for inline code: method names, class names, file paths, identifiers, and short code samples
  (for example `SateenProcessor`, `build.slnx`).
- Use only ASCII characters. Replace em dashes with hyphens (-) and smart quotes with straight quotes (").
- Don't use bold or other markdown formatting in the body.
- Wrap lines at 72 characters for readability in git logs and tooling.
