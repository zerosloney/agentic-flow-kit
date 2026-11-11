---
name: wiki
description: Project wiki organization and verification skill. Responsible for moving scattered documents into wiki/ and maintaining INDEX.md, 知识沉淀总览.html, and archive consistency.
---

# Wiki Organization and Verification Skill

## Goal
Build and maintain a structured project knowledge base, ensuring three-way consistency among disk files, index files, and the visual board.

## Triggers
- User command: `整理 wiki` / `归类文档` / `建知识库` / `同步知识沉淀看板` / `新增文档到 wiki`.

## Scope and constraints
- **Inclusion scope**:
    - **In**: master-data knowledge documents, project-wide data-maintenance SQL.
    - **Out**: the `workflow/` directory, non-master-data knowledge documents such as MTO/procurement/inventory/UI, dependency lock files, IDE configuration.
- **Directory structure**: `wiki/<主题>/<关键词文件>`.
- **Naming convention**: `<主题>-<关键词>[-范围/版本].ext`.
- **Authority**: `.md` is the content source $\rightarrow$ `.html` is the display snapshot. On conflict, `.md` wins.
- **Operation limits**: only copy (`Copy-Item`/`cp`). Deleting original files requires separate user confirmation.

## Standard operating procedure

### 1. Organize and place (batch/new)
1. **Topic determination**: read the first 8 lines of the file and determine the topic from the content. New topics must be aligned with the user.
2. **Directory creation**: create `wiki/<主题>/` and the corresponding `wiki/drafts-archive/YYYY-MM-DD_<主题>/`.
3. **File migration**:
    - Copy the file to `wiki/<主题>/` and rename it per the convention.
    - Copy the original file into `drafts-archive/` for provenance.
4. **Index update**: run `node .agents/scripts/gen-wiki-board.mjs`.
5. **Description completion**: fill in a description for the new topic in the "Purpose" column of the quick-view table in `wiki/INDEX.md`, then run the generator again.

### 2. Add a single document
1. Determine the topic $\rightarrow$ copy to `wiki/<主题>/` $\rightarrow$ run the generator $\rightarrow$ run the verification script.

### 3. Fix misplacement
1. Move the file to the correct topic directory $\rightarrow$ run the generator $\rightarrow$ run the verification script. Leave `drafts-archive` untouched.

## Verification mechanism
Run after every change:
```bash
node .agents/scripts/verify-wiki-consistency.mjs
```
**Acceptance criteria**:
- `exit 0` and output `✅ wiki 三方一致`.
- Checks cover: disk $\leftrightarrow$ INDEX $\leftrightarrow$ board DATA $\leftrightarrow$ data-maintenance ledger $\leftrightarrow$ link reachability.

## Maintenance notes
- **Generated regions**: the counts/mapping table in `wiki/INDEX.md` and the DATA block in `知识沉淀总览.html` are auto-generated; do not modify them manually.
- **Manual edit spots**: maintain only the "Purpose" column in `wiki/INDEX.md` and the ledger in `wiki/数据维护/README.md`.
- **Conflict handling**: when the wiki conflicts with `AGENTS.md` or `workflow`, the latter wins.
- **Commit convention**: adjusting wiki content (adding/modifying/deleting/renaming/placing knowledge documents, INDEX, boards, this skill file) is a docs-level change, **exempt from the workflow trio** (no intents/specs/plans, no confirmation door); commit directly (`docs(wiki): <action>`); the single rule source = root `AGENTS.md` §4 "wiki exemption". Deleting files still requires separate user confirmation (see "Operation limits").
