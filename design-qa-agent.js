#!/usr/bin/env node
/**
 * Design QA Agent — workshop stub
 *
 * Runs on every pull request. Fetches the diff, checks it against the
 * design system's component manifest, and posts a pass/fail result back
 * to the PR.
 *
 * ALREADY WIRED: fetching the diff, reading the manifest, calling
 * Claude, handling API errors, parsing the response, posting the
 * result, exiting with the right status code.
 *
 * YOUR JOB: fill in buildPrompt() — write the prompt that decides
 * whether the diff follows the design system.
 *
 * File paths below are placeholders. Update them to match your repo.
 */

import fs from "node:fs";

// --- Placeholders — update these to match your repo structure ---
const PLACEHOLDER_MANIFEST_PATH = "./manifest.json"; // now pointed at the real manifest
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // swap for 'claude-sonnet-5' if you want stronger reasoning

// ============================================================
// ALREADY WIRED — fetch the PR diff
// ============================================================
async function fetchDiff() {
  const repo = process.env.GITHUB_REPOSITORY; // e.g. "your-username/your-repo"
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch diff: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// ============================================================
// ALREADY WIRED — read the component manifest
// ============================================================
function readManifest() {
  return fs.readFileSync(PLACEHOLDER_MANIFEST_PATH, "utf-8");
}

// ============================================================
// YOUR JOB — write the prompt
//
// This is the only part you need to write. Everything else below
// (calling the API, handling errors, parsing the result) is already
// wired up and working.
//
// Write a prompt that asks Claude to compare the diff against the
// manifest and decide pass/fail. Things worth including:
//   - Reference the manifest explicitly, don't just say "the design system"
//   - Say what counts as an issue: breaking a rule in the manifest,
//     and nothing else. Then adding a rule to the manifest is enough
//     to start checking it, with no change to this prompt
//   - Ask for structured reasoning, not just a verdict
//
// IMPORTANT: whatever you ask for, it must come back as valid JSON in
// exactly this shape, because that's what the code below expects:
//   {
//     "pass": true or false,
//     "findings": [
//       { "file": "...", "line": "...", "issue": "...", "reasoning": "..." }
//     ]
//   }
// If there are no issues, "pass" should be true and "findings" empty.
// ============================================================
function buildPrompt(diff, manifest) {
  return `You are a design system reviewer. Your job is to check a code diff against a design system manifest and decide whether it passes.

<manifest>
${manifest}
</manifest>

<diff>
${diff}
</diff>

## What counts as an issue

An issue is a change in the diff that breaks a rule stated in the manifest above. Nothing else counts as an issue.

- Judge only against the rules in the manifest. If something is not covered by a rule in the manifest, do not report it, even if you personally think it is bad practice, inconsistent, or could be improved.
- Do not report style, naming, performance, accessibility, or correctness problems unless the manifest has a rule about them.
- Only review lines that were added or modified in the diff (lines starting with "+"). Do not report problems in unchanged context lines or removed lines.
- If a rule in the manifest is ambiguous and you cannot tell whether the diff breaks it, do not report it.
- If the diff contains no changes relevant to any rule in the manifest, it passes.

## How to review

Work through this internally before answering:
1. Read the manifest and list the rules that could apply to the changes in this diff.
2. For each added or modified line, check whether it breaks any of those rules.
3. For every violation, identify the exact file, the line, and the specific manifest rule that is broken.

## Output format

Respond with valid JSON only. No markdown code fences, no text before or after the JSON. Use exactly this shape:

{
  "pass": true or false,
  "findings": [
    {
      "file": "path/to/file",
      "line": "line number or range from the diff, as a string",
      "issue": "short description of what is wrong",
      "reasoning": "which manifest rule is broken, quoting or naming the rule, and why this change breaks it"
    }
  ]
}

Rules for the output:
- "pass" must be true if and only if "findings" is empty.
- If there are no issues, return {"pass": true, "findings": []}.
- Every finding must cite a specific rule from the manifest in its "reasoning". If you cannot point to a rule, it is not a finding.
- Keep "issue" to one sentence. Use "reasoning" for the explanation.
- All values must be valid JSON strings (escape quotes and newlines).`;
}


// ============================================================
// ALREADY WIRED — calls Claude, checks for API errors, and parses
// the JSON response. You shouldn't need to touch this function.
// ============================================================
async function checkDesignCompliance(diff, manifest) {
  const prompt = buildPrompt(diff, manifest);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`Anthropic API error (status ${response.status}):`, JSON.stringify(data, null, 2));
    return {
      pass: false,
      findings: [{
        file: "-",
        line: "-",
        issue: "API call failed",
        reasoning: data?.error?.message || `HTTP ${response.status}`,
      }],
    };
  }

  const text = data.content?.[0]?.text ?? "";

  try {
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
    const result = JSON.parse(cleaned);
    return {
      pass: result.pass === true,
      findings: Array.isArray(result.findings) ? result.findings : [],
    };
  } catch (err) {
    console.error("Failed to parse Claude's response as JSON:", text);
    return {
      pass: false,
      findings: [{ file: "-", line: "-", issue: "Agent response could not be parsed", reasoning: text.slice(0, 300) }],
    };
  }
}


// ============================================================
// ALREADY WIRED — post the result back to the PR
// ============================================================
async function postResult(result) {
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;

  const body = result.pass
    ? `Design QA agent: no issues found.`
    : `Design QA agent found issues:\n\n${result.findings
        .map((f) => `- **${f.file}:${f.line}** — ${f.issue}\n  ${f.reasoning}`)
        .join("\n")}`;

  const commentRes = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!commentRes.ok) {
    const errText = await commentRes.text();
    console.error(`Failed to post comment (status ${commentRes.status}):`, errText);
  } else {
    console.log("Comment posted successfully.");
  }

  // Non-zero exit makes the GitHub Action report a failed check.
  process.exit(result.pass ? 0 : 1);
}

// ============================================================
// ALREADY WIRED — run it
// ============================================================
(async function main() {
  try {
    const diff = await fetchDiff();
    const manifest = readManifest();
    const result = await checkDesignCompliance(diff, manifest);
    await postResult(result);
  } catch (err) {
    console.error("Design QA agent failed to run:", err);
    process.exit(1);
  }
})();