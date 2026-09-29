#!/usr/bin/env python3
"""Deterministic lint for trust-min protocol spec documents.

Usage:
  python lint_spec.py FILE [FILE ...]   lint documents (pass the WHOLE
                                        suite in one call so cross-file
                                        checks work)
  python lint_spec.py --self-test       run embedded fixtures

Exit 1 on any ERROR. Checks:
  E1  no real `Security Considerations` heading (whole-heading match
      on unfenced lines only — a heading inside a code fence doesn't
      count)
  E2  unresolved {{SENTINEL}} placeholder
  E3  duplicate stable-ID definition (global across all input files;
      reported once per duplicate definition site)
  E4  local relative link target does not exist (repo-absolute
      /paths like the EIP CC0 waiver are skipped)
  E5  retained template guidance marker `<!-- TEMPLATE:`
  E6  SP/TEST lacks its required parent, or REQ lacks SP/Necessity justification
  E7  SP definition lacks an Evidence declaration
  E8  stable ID referenced but defined in none of the input files
  E9  defined ASM/SP has no dependent in the next traceability layer
  E10 defined REQ has neither a TEST nor an explicit Verification method
  Withdrawn definitions remain reserved and duplicate-checked but are exempt
      from E6-E10.
  W1  uppercase BCP 14 keyword under a non-normative heading
      (inherited by subsections)
  W2  normative sentence with no identifiable actor before its first
      keyword — checked per sentence after stripping the ID prefix,
      so both `REQ-A-01: Identity MUST ...` and an actorless second
      sentence are flagged
  W4  sentence containing two or more BCP 14 keywords (non-atomic)
"""
import re
import sys
import tempfile
from pathlib import Path

KEYWORDS = r"MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|REQUIRED|RECOMMENDED|NOT RECOMMENDED|OPTIONAL|MAY"
KW_RE = re.compile(rf"\b({KEYWORDS})\b")
ID_PATTERN = r"(?:REQ|SP|ASM|TEST)(?:-[A-Z0-9]+)+-[0-9]+[A-Z]?"
ID_RE = re.compile(rf"\b({ID_PATTERN})\b")
ID_DEF_RE = re.compile(rf"^\s*(?:[-*]\s*)?({ID_PATTERN})\s*(?:\([^)]*\))?\s*[:—–-]\s*")
SENTINEL_RE = re.compile(r"\{\{[^{}]+\}\}")
TEMPLATE_MARK = "<!-- TEMPLATE:"
LINK_RE = re.compile(r"\]\((?!https?://|#|mailto:)([^)]+)\)")
HEAD_RE = re.compile(r"^(#{1,6})\s+(.*)$")
SEC_CONS_RE = re.compile(r"^#{1,6}\s+(?:\d+(?:\.\d+)*\.?\s+)?Security Considerations\s*$")
NONNORM = re.compile(r"non-normative|rationale|motivation|overview|abstract", re.I)
ACTOR_RE = re.compile(r"\b[Tt]he\s+[A-Z][\w-]*")
BCP14_HINT = re.compile(r"key words|when, and only when", re.I)
SENT_SPLIT = re.compile(r"(?<=[.;!?])\s+")


def visible_markdown_lines(lines):
    """Strip HTML comments and code fences while preserving visible text."""
    visible, comment, fence = [], False, None
    for ln in lines:
        stripped = ln.strip()
        if fence is not None:
            if stripped.startswith(fence):
                fence = None
            visible.append("")
            continue
        if not comment:
            match = re.match(r"^(`{3,}|~{3,})", stripped)
            if match:
                fence = match.group(1)[0] * len(match.group(1))
                visible.append("")
                continue

        out, offset = [], 0
        while offset < len(ln):
            if comment:
                end = ln.find("-->", offset)
                if end < 0:
                    offset = len(ln)
                    break
                comment = False
                offset = end + 3
            else:
                start = ln.find("<!--", offset)
                if start < 0:
                    out.append(ln[offset:])
                    break
                out.append(ln[offset:start])
                comment = True
                offset = start + 4
        visible.append("".join(out))
    return visible


def fence_flags(lines):
    flags, fence = [], None
    for ln in lines:
        s = ln.strip()
        m = re.match(r"^(`{3,}|~{3,})", s)
        if m:
            if fence is None:
                fence = m.group(1)[0] * len(m.group(1))
            elif s.startswith(fence):
                fence = None
            flags.append(True)
            continue
        flags.append(fence is not None)
    return flags


def paragraphs(lines, flags):
    buf, start = [], None
    for i, (ln, fenced) in enumerate(zip(lines, flags), 1):
        if fenced or not ln.strip() or HEAD_RE.match(ln):
            if buf:
                yield start, " ".join(buf)
                buf, start = [], None
            continue
        if start is None:
            start = i
        buf.append(ln.strip())
    if buf:
        yield start, " ".join(buf)


def definition_blocks(lines):
    """Yield each stable-ID definition with continuation lines until the next definition or boundary."""
    current, start = [], None
    for i, ln in enumerate(lines, 1):
        definition = ID_DEF_RE.match(ln)
        boundary = not ln.strip() or HEAD_RE.match(ln)
        if definition or boundary:
            if current:
                yield start, " ".join(current)
                current, start = [], None
            if definition:
                current, start = [ln.strip()], i
            continue
        if current:
            current.append(ln.strip())
    if current:
        yield start, " ".join(current)


def lint_file(path, id_defs, trace_nodes, findings, refs_out):
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    flags = fence_flags(lines)
    visible = visible_markdown_lines(lines)

    if not any(SEC_CONS_RE.match(ln) for ln in visible):
        findings.append(("ERROR", path, 0, "E1 no 'Security Considerations' heading (fenced/commented headings don't count)"))

    stack = []
    nonnorm_at = {}
    for i, ln in enumerate(lines, 1):
        if flags[i - 1]:
            continue
        m = HEAD_RE.match(ln)
        if m:
            lvl = len(m.group(1))
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            stack.append((lvl, bool(NONNORM.search(m.group(2)))))
        nonnorm_at[i] = any(nn for _, nn in stack)
        sm = SENTINEL_RE.search(ln)
        if sm:
            findings.append(("ERROR", path, i, f"E2 unresolved sentinel: {sm.group(0)}"))
        if TEMPLATE_MARK in ln:
            findings.append(("ERROR", path, i, "E5 retained template guidance marker"))
        for lm in LINK_RE.finditer(ln):
            target = lm.group(1).split("#")[0].strip()
            if target and not target.startswith("/") and not (path.parent / target).exists():
                findings.append(("ERROR", path, i, f"E4 broken local link: {target}"))
        dm = ID_DEF_RE.match(ln)
        if dm:
            id_defs.setdefault(dm.group(1), []).append((path, i))
        for rm in ID_RE.finditer(ln):
            refs_out.append((path, i, rm.group(1)))

    for start, block in definition_blocks(visible):
        definition = ID_DEF_RE.match(block)
        sid = definition.group(1)
        if re.match(r"Withdrawn\b", block[definition.end():].lstrip()):
            continue
        targets = {m.group(1) for m in ID_RE.finditer(block) if m.group(1) != sid}
        trace_nodes.setdefault(sid, []).append((path, start, targets, block))
        kind = sid.split("-", 1)[0]
        required = {"SP": {"ASM"}, "TEST": {"REQ"}}.get(kind)
        if required and not any(target.split("-", 1)[0] in required for target in targets):
            findings.append(("ERROR", path, start, f"E6 {sid} lacks required {'/'.join(sorted(required))} traceability parent"))
        if kind == "REQ" and not any(target.startswith("SP-") for target in targets) and "Necessity:" not in block:
            findings.append(("ERROR", path, start, f"E6 {sid} lacks SP parent or Necessity justification"))
        if kind == "SP" and "Evidence:" not in block:
            findings.append(("ERROR", path, start, f"E7 {sid} lacks Evidence declaration"))

    for start, para in paragraphs(lines, flags):
        if BCP14_HINT.search(para):
            continue
        body = ID_DEF_RE.sub("", para, count=1)
        first_kw = KW_RE.search(body)
        if first_kw and nonnorm_at.get(start, False):
            findings.append(("WARN", path, start, f"W1 '{first_kw.group(1)}' under non-normative heading"))
            continue
        for sent in SENT_SPLIT.split(body):
            kw = KW_RE.search(sent)
            if not kw:
                continue
            if not ACTOR_RE.search(sent[: kw.start()]):
                findings.append(("WARN", path, start, f"W2 no actor before '{kw.group(1)}': {sent[:70]}"))
            if len(KW_RE.findall(sent)) >= 2:
                findings.append(("WARN", path, start, f"W4 multiple keywords in one sentence: {sent[:70]}"))
    return text


def run(paths):
    findings, id_defs, trace_nodes, refs = [], {}, {}, []
    for p in paths:
        if not p.exists():
            findings.append(("ERROR", p, 0, "file not found"))
            continue
        lint_file(p, id_defs, trace_nodes, findings, refs)
    for sid, sites in id_defs.items():
        for path, line in sites[1:]:
            findings.append(("ERROR", path, line, f"E3 duplicate definition of {sid} (first: {sites[0][0].name}:{sites[0][1]})"))
    if len(paths) > 1:
        for p, i, sid in refs:
            if sid not in id_defs:
                findings.append(("ERROR", p, i, f"E8 {sid} referenced but defined in none of the linted files"))
        incoming = {}
        for source, definitions in trace_nodes.items():
            for _, _, targets, _ in definitions:
                for target in targets:
                    incoming.setdefault(target, set()).add(source)
        for sid, definitions in trace_nodes.items():
            kind = sid.split("-", 1)[0]
            expected_child = {"ASM": "SP", "SP": "REQ"}.get(kind)
            children = incoming.get(sid, set())
            if expected_child and not any(child.startswith(expected_child + "-") for child in children):
                path, line, _, _ = definitions[0]
                findings.append(("ERROR", path, line, f"E9 {sid} has no {expected_child} dependent"))
            if kind == "REQ" and not any(child.startswith("TEST-") for child in children):
                path, line, _, para = definitions[0]
                if "Verification:" not in para:
                    findings.append(("ERROR", path, line, f"E10 {sid} has no TEST dependent or Verification method"))
    else:
        print("note: single-file lint — cross-file checks (E3 and E8-E10) limited; lint the whole suite together before completion")
    errors = 0
    for sev, p, i, msg in sorted(findings, key=lambda f: (str(f[1]), f[2], f[3])):
        print(f"{sev}: {p}:{i}: {msg}")
        errors += sev == "ERROR"
    print(f"\n{errors} error(s), {len(findings) - errors} warning(s) across {len(paths)} file(s)")
    return 1 if errors else 0


FIXTURES = {
    "E1-missing": ("# Doc\nThe Backend MUST act.\n", "ERROR", "E1", None),
    "E1-fake-heading": ("# Doc\nWe address security considerations later.\n## My Security Considerations Notes\nThe Backend MUST act.\n", "ERROR", "E1", None),
    "E2": ("# Doc\n## Security Considerations\nUse {{NAME}} here.\n", "ERROR", "E2", None),
    "E3-same-file-x2": ("# Doc\n## Security Considerations\nREQ-A-01: The Backend MUST x.\nREQ-A-01: The Backend MUST y.\nREQ-A-01: The Backend MUST z.\n", "ERROR", "E3", 2),
    "E3-namespaced": ("# Doc\n## Security Considerations\nREQ-POPUP-CONT-05A: The Backend MUST x.\nREQ-POPUP-CONT-05A: The Backend MUST y.\n", "ERROR", "E3", 1),
    "E4": ("# Doc\n## Security Considerations\nSee [x](missing-file.md).\n", "ERROR", "E4", None),
    "E5": ("# Doc\n## Security Considerations\n<!-- TEMPLATE: fill this in -->\n", "ERROR", "E5", None),
    "W1": ("# Doc\n## Overview (non-normative)\n### Sub\nThe Client MUST not be here.\n\n## Security Considerations\n", "WARN", "W1", None),
    "W2-plain": ("# Doc\nIt MUST be\nvalidated somehow.\n\n## Security Considerations\n", "WARN", "W2", None),
    "W2-id-prefixed": ("# Doc\nREQ-A-01: Identity MUST be validated.\n\n## Security Considerations\n", "WARN", "W2", None),
    "W4": ("# Doc\nREQ-A-01: The Backend MUST verify state and MUST attest the binding.\n\n## Security Considerations\n", "WARN", "W4", None),
    "W2-second-sentence": ("# Doc\nREQ-A-01: The Backend MUST validate the token. Identity MUST be bound.\n\n## Security Considerations\n", "WARN", "W2", 1),
    "E1-fenced-heading": ("# Doc\n```markdown\n## Security Considerations\n```\nThe Backend MUST act.\n", "ERROR", "E1", None),
    "E1-commented-heading": ("# Doc\n<!--\n## Security Considerations\n-->\nThe Backend MUST act.\n", "ERROR", "E1", None),
    "E1-comment-marker-in-fence": ("# Doc\n```html\n<!--\n```\n## Security Considerations\n", None, None, None),
    "E1-close-reopen-comment": ("# Doc\n<!--\n--> <!--\n## Security Considerations\n-->\n", "ERROR", "E1", None),
    "W2-question-boundary": ("# Doc\nREQ-A-01: The Backend MUST validate the token, right? Identity MUST be bound.\n\n## Security Considerations\n", "WARN", "W2", 1),
    "W2-table-label": ("# Doc\n| Context | MUST NOT access |\n|---|---|\n| Application | Credentials |\n\n## Security Considerations\n", "WARN", "W2", 1),
    "clean-table-label": ("# Doc\n| Context | Prohibited access |\n|---|---|\n| Application | Credentials |\n\n## Security Considerations\n", None, None, None),
    "clean-lowercase-the-actor": ("# Doc\nASM-A-01 — assumption.\nSP-A-01 — Goal. Depends on ASM-A-01. Evidence: audit.\nREQ-A-01 (upholds SP-A-01): Before integer conversion, the Verifier Contract MUST reject invalid input.\nTEST-A-01: Covers REQ-A-01.\n\n## Security Considerations\n", None, None, None),
    "clean-absolute-link": ("# Doc\n## Security Considerations\nCopyright and related rights waived via [CC0](/LICENSE).\nThe Backend MUST log denials.\n", None, None, None),
    "E6-SP-parent": ("# Doc\nSP-A-01 — Goal. Evidence: audit.\n## Security Considerations\n", "ERROR", "E6", None),
    "E6-REQ-parent": ("# Doc\nREQ-A-01: The Backend MUST act.\n## Security Considerations\n", "ERROR", "E6", None),
    "E6-TEST-parent": ("# Doc\nTEST-A-01: valid vector.\n## Security Considerations\n", "ERROR", "E6", None),
    "E7": ("# Doc\nASM-A-01 — assumption.\nSP-A-01 — Goal. Depends on: ASM-A-01.\n## Security Considerations\n", "ERROR", "E7", None),
    "clean": ("# Doc\nASM-A-01 — assumption.\nSP-A-01 — Goal. Depends on ASM-A-01. Evidence: audit.\nREQ-A-01 (upholds SP-A-01): The Backend MUST reject bad input.\nTEST-A-01: Covers REQ-A-01.\n\n## Security Considerations\n", None, None, None),
    "clean-necessity": ("# Doc\nREQ-A-01: The Backend MUST return the versioned response.\nNecessity: independently implemented clients must decode it.\nTEST-A-01: Covers REQ-A-01.\n\n## Security Considerations\n", None, None, None),
}


def self_test():
    import contextlib, io
    failed = 0
    for name, (content, sev, code, count) in FIXTURES.items():
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "t.md"
            f.write_text(content)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                run([f])
            out = buf.getvalue()
            if code is None:
                ok = "ERROR" not in out and "WARN" not in out
            else:
                ok = f"{sev}:" in out and code in out
                if count is not None:
                    hits = sum(1 for line in out.splitlines() if line.startswith(f"{sev}:") and f"{code} " in line)
                    ok = ok and hits == count
            print(f"{'PASS' if ok else 'FAIL'} {name}")
            failed += not ok
    with tempfile.TemporaryDirectory() as d:
        a = Path(d) / "a.md"; b = Path(d) / "b.md"
        a.write_text("# A\nREQ-A-01: The Backend MUST x.\n## Security Considerations\n")
        b.write_text("# B\nREQ-A-01: The Backend MUST y.\nUpholds SP-NOPE-01.\n```\nREQ-FENCED-99: example only\n```\n## Security Considerations\n")
        import contextlib, io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            run([a, b])
        out = buf.getvalue()
        ok = out.count("E3 ") == 1 and "E8" in out and "SP-NOPE-01" in out and "REQ-FENCED-99" not in out
        print(f"{'PASS' if ok else 'FAIL'} cross-file")
        failed += not ok
    with tempfile.TemporaryDirectory() as d:
        a = Path(d) / "a.md"; b = Path(d) / "b.md"
        a.write_text("# A\nASM-POPUP-01: assumption.\nSP-POPUP-01: Goal. Depends on ASM-POPUP-01. Evidence: audit.\nREQ-POPUP-CONT-05A (upholds SP-POPUP-01): The Backend MUST act.\nREQ-POPUP-CONT-06 (upholds SP-POPUP-01): The Backend MUST stop.\n## Security Considerations\n")
        b.write_text("# B\nTEST-POPUP-01 (exercises REQ-POPUP-CONT-05A): valid vector.\nSee REQ-POPUP-CONT-99.\n## Security Considerations\n")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            run([a, b])
        errors = [line for line in buf.getvalue().splitlines() if line.startswith("ERROR:")]
        ok = (len(errors) == 2
              and any("E8 REQ-POPUP-CONT-99 " in line for line in errors)
              and any("E10 REQ-POPUP-CONT-06 " in line for line in errors))
        print(f"{'PASS' if ok else 'FAIL'} namespaced-traceability")
        failed += not ok
    with tempfile.TemporaryDirectory() as d:
        a = Path(d) / "a.md"; b = Path(d) / "b.md"
        a.write_text("# A\nASM-A-01 — assumption.\nSP-A-01 — Goal. Depends on ASM-A-01. Evidence: audit.\nREQ-A-01 (upholds SP-A-01): The Backend MUST act.\nASM-X-01 — another assumption.\nSP-X-01 — Orphan goal. Depends on ASM-X-01. Evidence: audit.\n## Security Considerations\n")
        b.write_text("# B\n## Security Considerations\n")
        import contextlib, io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            run([a, b])
        out = buf.getvalue()
        ok = "E9 SP-X-01" in out and "E10 REQ-A-01" in out and "E9 ASM-X-01" not in out and "E9 ASM-A-01" not in out and "E9 SP-A-01" not in out
        print(f"{'PASS' if ok else 'FAIL'} trace-orphans")
        failed += not ok
    with tempfile.TemporaryDirectory() as d:
        a = Path(d) / "a.md"; b = Path(d) / "b.md"
        a.write_text("# A\nASM-W-01 — Withdrawn.\nSP-W-01 — Withdrawn.\nREQ-W-01: Withdrawn.\nTEST-W-01: Withdrawn.\n## Security Considerations\n")
        b.write_text("# B\nREQ-W-01: Withdrawn.\n## Security Considerations\n")
        import contextlib, io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            run([a, b])
        out = buf.getvalue()
        ok = out.count("ERROR:") == 1 and "E3 duplicate definition of REQ-W-01" in out and not any(code in out for code in ("E6 ", "E7 ", "E9 ", "E10 "))
        print(f"{'PASS' if ok else 'FAIL'} withdrawn")
        failed += not ok
    print(f"\nself-test: {failed} failure(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--self-test"]:
        sys.exit(self_test())
    if not args:
        print(__doc__)
        sys.exit(2)
    sys.exit(run([Path(a) for a in args]))
