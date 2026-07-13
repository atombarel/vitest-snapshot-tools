import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("skills/review-vitest-snapshots");
const skill = await readFile(resolve(root, "SKILL.md"), "utf8");
const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
if (!match) throw new Error("SKILL.md requires YAML frontmatter");
const frontmatter = match[1] ?? "";
if (!/^name:\s*review-vitest-snapshots$/m.test(frontmatter))
  throw new Error("Skill name is missing or invalid");
if (!/^description:\s*.+$/m.test(frontmatter))
  throw new Error("Skill description is missing");
if (/^(?!name:|description:)[a-z][a-z_-]*:/m.test(frontmatter))
  throw new Error("SKILL.md has unsupported frontmatter fields");
await access(resolve(root, "agents/openai.yaml"));
await access(resolve(root, "references/cli-json.md"));
console.log("review-vitest-snapshots skill is valid");
