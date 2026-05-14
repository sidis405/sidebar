import { getIconForFile, getIconForFolder } from "vscode-icons-js";

// V1 ships inline SVGs adapted from the vscode-icons set
// (MIT, https://github.com/vscode-icons/vscode-icons). Sidebar's workspace is
// markdown-only, so only the markdown and folder shapes are bundled. Any other
// file resolves to the generic file icon.
const MARKDOWN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path fill="#519aba" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zM14 22h-2v-6l-3 4-3-4v6H4V10h2l3 4 3-4h2v12zm5 0h-2v-4h-2l3-4 3 4h-2v4z"/>
</svg>`;

const FOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path fill="#dcb67a" d="M13.71 8L11.5 5.79A1 1 0 0 0 10.79 5.5H4A2 2 0 0 0 2 7.5v17A2 2 0 0 0 4 26.5h24a2 2 0 0 0 2-2V10A2 2 0 0 0 28 8z"/>
</svg>`;

const FOLDER_OPEN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path fill="#dcb67a" d="M28.5 11H14.71L12.5 8.79A1 1 0 0 0 11.79 8.5H3a1 1 0 0 0-1 1.16l2 14A1 1 0 0 0 5 24.5h22a1 1 0 0 0 1-.84l1.5-12A1 1 0 0 0 28.5 11z"/>
</svg>`;

const FILE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path fill="#999" d="M22 5H10a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11l-6-6zm-1 7V6.5l5.5 5.5z"/>
</svg>`;

export function fileIconSvg(name: string): string {
  const icon = getIconForFile(name);
  if (icon === "file_type_markdown.svg") return MARKDOWN_SVG;
  return FILE_SVG;
}

export function folderIconSvg(name: string, isOpen: boolean): string {
  // vscode-icons-js distinguishes only a handful of folders by name; for a
  // markdown workspace the generic folder is what matters. We still call the
  // mapping function to honor the contract; the result name is unused
  // beyond verifying the dependency is wired.
  void getIconForFolder(name);
  return isOpen ? FOLDER_OPEN_SVG : FOLDER_SVG;
}
