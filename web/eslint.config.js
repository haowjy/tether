import tseslint from "typescript-eslint";

// Native owns the keyboard and focus (plan.md "Standards"): no element may take focus
// except the v2 editor. Taps go through ui/Tappable; short text entry asks native.
const bannedTags = "button|input|textarea|select";
const focusRules = [
  {
    selector: `JSXOpeningElement[name.name=/^(${bannedTags})$/]`,
    message: "Raw <button>/<input>/<textarea>/<select> are banned: use ui/Tappable, or ask native for a prompt.",
  },
  {
    selector: "JSXAttribute[name.name=/^(contentEditable|contenteditable)$/]",
    message: "contenteditable is banned: native owns text entry.",
  },
  {
    selector: `CallExpression[callee.property.name='createElement'][arguments.0.value=/^(${bannedTags})$/]`,
    message: "Do not create focusable elements by hand.",
  },
];

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: { "no-restricted-syntax": ["error", ...focusRules] },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
);
