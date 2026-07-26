import { escapeHtml } from "../lib/html.js";

// Standard Nutrition Company brand guidelines (parent-company palette/type,
// per SNC Brand Guidelines_Approved.pdf p.9-10):
//   Red #DA291C (PMS 485C) / Dark Red #9A3324 (PMS 484C) / Black #2C2A29 (PMS BlackC)
//   Ubuntu (Bold headlines, Regular body, Light small text) — Google Font, free
export const BRAND = {
  red: "#DA291C",
  darkRed: "#9A3324",
  black: "#2C2A29",
  redTint10: "#FBE9E8",
  redTintBorder: "#F0C3C0",
  redTint10Dark: "#3A1512",
  redTintBorderDark: "#6B241D",
};

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link href="https://fonts.googleapis.com/css2?family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,500&display=swap" rel="stylesheet" />';

const BASE_STYLES = `
  :root { color-scheme: light dark; }
  body {
    font-family: 'Ubuntu', Arial, sans-serif;
    max-width: 640px;
    margin: 3rem auto;
    padding: 0 1rem;
    color: ${BRAND.black};
    background: #ffffff;
  }
  main.wide { max-width: 960px; }
  .brand-header {
    display: flex;
    align-items: center;
    border-bottom: 3px solid ${BRAND.red};
    padding-bottom: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .brand-logo-wrap {
    display: inline-block;
    background: #ffffff;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    line-height: 0;
  }
  .brand-logo { display: block; height: 32px; width: auto; }
  h1 { font-weight: 700; font-size: 1.4rem; color: ${BRAND.black}; }
  h2 { font-weight: 700; font-size: 1.05rem; color: ${BRAND.darkRed}; margin-top: 2rem; }
  .notice {
    background: ${BRAND.redTint10};
    color: ${BRAND.darkRed};
    border: 1px solid ${BRAND.redTintBorder};
    border-radius: 6px;
    padding: 0.75rem 1rem;
  }
  .downloads { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .button {
    display: inline-block;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    background: ${BRAND.red};
    color: #fff;
    font-weight: 500;
    text-decoration: none;
  }
  .button:hover { background: ${BRAND.darkRed}; }
  form { margin-top: 0.5rem; }
  label { display: block; font-weight: 500; margin: 0.6rem 0 0.2rem; }
  input[type="text"], input[type="email"] {
    font-family: 'Ubuntu', Arial, sans-serif;
    font-size: 1rem;
    padding: 0.45rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #ccc;
    width: 100%;
    max-width: 320px;
    box-sizing: border-box;
  }
  button[type="submit"] {
    font-family: 'Ubuntu', Arial, sans-serif;
    font-weight: 500;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    border: none;
    background: ${BRAND.red};
    color: #fff;
    cursor: pointer;
  }
  button[type="submit"]:hover { background: ${BRAND.darkRed}; }
  .brand-footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid #ddd;
    font-weight: 300;
    font-size: 0.8rem;
    color: #767573;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #ededed; background: #171514; }
    input[type="text"], input[type="email"] { background: #232120; color: #ededed; border-color: #45423f; }
    .notice { background: ${BRAND.redTint10Dark}; color: #f5b9b4; border-color: ${BRAND.redTintBorderDark}; }
    h1 { color: #f5f5f5; }
    h2 { color: #e08b85; }
    .brand-footer { border-top-color: #3a3836; color: #9a9896; }
  }
`;

export interface LayoutOptions {
  wide?: boolean;
  extraStyles?: string;
}

export function renderLayout(title: string, body: string, options: LayoutOptions = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/branding/favicon.png" />
${FONT_LINK}
<style>${BASE_STYLES}${options.extraStyles ?? ""}</style>
</head>
<body>
<main${options.wide ? ' class="wide"' : ""}>
<div class="brand-header">
  <span class="brand-logo-wrap"><img class="brand-logo" src="/branding/logo-horizontal.png" alt="Standard Nutrition Company" /></span>
</div>
${body}
<div class="brand-footer">Standard Nutrition Company &middot; standardnutrition.com</div>
</main>
</body>
</html>`;
}
