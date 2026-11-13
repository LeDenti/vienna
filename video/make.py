#!/usr/bin/env python3
"""vienna — the 3-minute demo video, built from real testnet runs.

Scenes are rendered with Pillow (cards, a replayed terminal, real screenshots), narrated by
macOS `say`, assembled with ffmpeg. Nothing in the terminal scene is typed by hand: the lines
come from measures/*.json written by `node bin/vienna.mjs demo`.

    video/.venv/bin/python video/make.py            # → video/build/vienna_demo_EN.mp4
    VOICE=Daniel RATE=165 video/.venv/bin/python video/make.py
"""
import glob, json, math, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "build")
VOICE = os.environ.get("VOICE", "Samantha")
RATE = os.environ.get("RATE", "172")
W, H, FPS = 1280, 720, 25
PAUSE = 0.8

BG = (15, 17, 21); CARD = (23, 26, 33); INK = (232, 233, 236); MUTE = (139, 144, 160)
OK = (60, 207, 122); BAD = (239, 91, 91); LOCK = (74, 81, 104); LINE = (38, 43, 54); BLUE = (155, 183, 255); WARN = (245, 183, 59)
SANS = "/System/Library/Fonts/Helvetica.ttc"; SANS_B = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"; MONO = "/System/Library/Fonts/Menlo.ttc"

def F(path, size): return ImageFont.truetype(path, size)
def canvas():
    im = Image.new("RGB", (W, H), BG); return im, ImageDraw.Draw(im)
def header(d, sub="XRP Ledger testnet"):
    d.text((44, 30), "vienna", font=F(SANS_B, 30), fill=INK)
    d.text((160, 38), "a deposit you get back automatically  ·  " + sub, font=F(SANS, 18), fill=MUTE)
    d.line((44, 76, W - 44, 76), fill=LINE, width=1)
def wrap(d, text, font, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines
def para(d, xy, text, font, fill, maxw, lh=None):
    x, y = xy; lh = lh or int(font.size * 1.35)
    for l in wrap(d, text, font, maxw): d.text((x, y), l, font=font, fill=fill); y += lh
    return y
def bullets(d, xy, items, font, fill=INK, maxw=1100, gap=14, dot=BLUE):
    x, y = xy
    for it in items:
        d.ellipse((x, y + font.size * 0.45, x + 9, y + font.size * 0.45 + 9), fill=dot)
        y = para(d, (x + 26, y), it, font, fill, maxw - 26) + gap
    return y
def save(im, name):
    p = os.path.join(OUT, name); im.save(p); return p

# ----------------------------------------------------------------------------------------- data
def latest(scenario):
    fs = sorted(glob.glob(os.path.join(ROOT, "measures", f"demo-{scenario}-*.json")))
    return json.load(open(fs[-1])) if fs else None
LATE, CONTESTED, CLEAN = latest("late"), latest("contested"), latest("clean")
AG = LATE["agreement"]

# ---------------------------------------------------------------------------------------- scenes
def s_title():
    im, d = canvas()
    d.text((W // 2, 250), "vienna", font=F(SANS_B, 110), fill=INK, anchor="mm")
    d.text((W // 2, 345), "a deposit you get back automatically", font=F(SANS, 40), fill=MUTE, anchor="mm")
    for i, c in enumerate([LOCK, LOCK, BAD, OK, OK]):
        x = W // 2 - 5 * 46 + i * 92; d.rounded_rectangle((x, 430, x + 72, 470), 8, fill=c)
    d.text((W // 2, 540), "everyday rental deposits as tranche escrows on the XRP Ledger", font=F(SANS, 24), fill=INK, anchor="mm")
    d.text((W // 2, 600), "proximata × HOIV × START Vienna · Building Better Worlds · crypto track with Crypto Club Vienna · 13–14 Nov 2026", font=F(SANS, 17), fill=MUTE, anchor="mm")
    return save(im, "s00.png")

def s_problem():
    im, d = canvas(); header(d, "the problem")
    d.text((44, 120), "Saturday. You rent an e-bike in Vienna.", font=F(SANS_B, 44), fill=INK)
    bullets(d, (60, 230), ["€200 blocked on your card, for up to a week.", "No credit card? No bike. Students, newcomers, half the world.", "A scratch at the end? A chargeback fight nobody wins.", "The shop holds your money and judges its own claim."], F(SANS, 32), gap=26)
    return save(im, "s01.png")

def s_how():
    im, d = canvas(); header(d, "how it works")
    d.text((44, 110), "The deposit becomes five escrows. Each has two locks.", font=F(SANS_B, 36), fill=INK)
    # renter → tranches → lender
    d.rounded_rectangle((70, 260, 290, 340), 14, fill=CARD, outline=LINE); d.text((180, 300), "renter", font=F(SANS_B, 28), fill=INK, anchor="mm")
    d.rounded_rectangle((990, 260, 1210, 340), 14, fill=CARD, outline=LINE); d.text((1100, 300), "lender", font=F(SANS_B, 28), fill=INK, anchor="mm")
    for i in range(5):
        x = 400 + i * 100; d.rounded_rectangle((x, 270, x + 80, 330), 10, fill=LOCK); d.text((x + 40, 300), "10", font=F(SANS_B, 26), fill=INK, anchor="mm")
    d.line((290, 300, 400, 300), fill=MUTE, width=3); d.line((880, 300, 990, 300), fill=MUTE, width=3)
    d.text((640, 225), "5 × EscrowCreate, 10 XRP each", font=F(MONO, 18), fill=MUTE, anchor="mm")
    # lock 1
    d.rounded_rectangle((330, 400, 790, 540), 14, fill=CARD, outline=LINE)
    d.text((350, 415), "lock 1 · Condition (secret held by the oracle)", font=F(SANS_B, 22), fill=WARN)
    para(d, (350, 452), "Only the written rules can move a tranche to the lender: the oracle reveals a secret, EscrowFinish. It cannot reveal more than the rules allow.", F(SANS, 19), INK, 420)
    # lock 2
    d.rounded_rectangle((810, 400, 1240, 540), 14, fill=CARD, outline=LINE)
    d.text((830, 415), "lock 2 · CancelAfter (written in the ledger)", font=F(SANS_B, 22), fill=OK)
    para(d, (830, 452), "Past the deadline, anyone can send every untouched tranche back to the renter: EscrowCancel. No signature of the lender or the oracle needed.", F(SANS, 19), INK, 390)
    d.text((44, 600), "Native XRP: no trust line, no issuer, nothing to freeze. The refund needs nobody's goodwill.", font=F(SANS, 24), fill=MUTE)
    return save(im, "s02.png")

def s_agreement():
    im, d = canvas(); header(d, "the agreement, priced before the rental")
    d.text((44, 110), AG["item"], font=F(SANS_B, 36), fill=INK)
    rows = [("deposit", f'{AG["deposit_xrp"]} XRP = {int(AG["deposit_xrp"]/AG["tranche_xrp"])} tranches × {AG["tranche_xrp"]}'),
            ("due", AG["due_at"][:19].replace("T", " ") + " UTC, grace 0"), ("late fee", f'{AG["late_fee_xrp_per_hour"]} XRP per started hour, cap {AG["late_fee_cap_xrp"]}'),
            ("accessories", ", ".join(f'{a["name"]} {a["value_xrp"]}' for a in AG["accessories"]) + "   (anything else: 0)"), ("cleaning", f'{AG["cleaning_fee_xrp"]} XRP'),
            ("damage", "renter agrees, or the arbiter decides; silence before the deadline = refund"), ("arbiter", AG["arbiter"]["name"]), ("dispute window", f'{AG["dispute_window_s"]} s in this demo (48 h in the case file)')]
    y = 190
    for k, v in rows:
        d.text((70, y), k, font=F(MONO, 24), fill=BLUE); d.text((330, y), v, font=F(MONO, 24), fill=INK); y += 48
    d.text((44, 620), "The deposit is the renter's money: every doubt is settled in the renter's favour.", font=F(SANS, 24), fill=MUTE)
    return save(im, "s03.png")

def terminal_lines(m):
    """The real run, condensed into terminal lines (text from measures, hashes real)."""
    a, w = m["agreement"], m["wallets"]; v = m["verdicts"]
    L = [("$", f"node bin/vienna.mjs demo {m['scenario']}"), ("", f"wallets renter {w['renter']}"), ("", f"        lender {w['lender']}"), ("", f"        oracle {w['oracle']}"),
         ("", f"agreement {a['id']}: deposit {a['deposit_xrp']} XRP in {int(a['deposit_xrp']/a['tranche_xrp'])} tranches of {a['tranche_xrp']}"),
         ("ok", f"locked {len(m['create'])} tranches  " + " ".join(c["hash"][:8] for c in m["create"]))]
    for item in v:
        vd = item["verdict"]; lines = ", ".join(f'{l["kind"]} {l["drops"]/1e6:g}' for l in vd["lines"]) or "nothing"
        L.append(("", f"{item['label']}:"))
        L.append(("v", f"  → {vd['status']}, lender keeps {vd['retention_drops']/1e6:g} XRP = {vd['tranches_to_lender']} tranche(s)   [{lines}]"))
        for n in vd.get("notes", []): L.append(("n", "  note: " + n))
        for e in vd.get("escalations", []): L.append(("n", f"  escalated: {e['what']} → {e['to']}"))
        if item["label"].startswith("after cancel_after") and m["cancel"]: L.append(("ok", f"  cancelled {len(m['cancel'])} tranche(s) back to renter  " + " ".join(c["hash"][:8] for c in m["cancel"])))
        elif m["finish"] and vd["tranches_to_lender"] and not any(x[1].startswith("  finished") for x in L): L.append(("bad", f"  finished {len(m['finish'])} tranche(s) to lender  " + " ".join(c["hash"][:8] for c in m["finish"])))
    L.append(("ok", f"done in {m['duration_s']}s, escrows left: {m.get('open_escrows_left', 0)}, lender {m['balances']['lender']} XRP"))
    return L

def s_terminal(m, name, title):
    """Frames of a terminal where lines appear one by one. Returns (frame_glob, n_frames, fps)."""
    lines = terminal_lines(m); fps = 2; frames = []
    for k in range(1, len(lines) + 1):
        im, d = canvas(); header(d, title)
        d.rounded_rectangle((44, 96, W - 44, H - 30), 12, fill=(10, 11, 14), outline=LINE)
        y = 112
        for kind, text in lines[:k]:
            col = {"$": INK, "ok": OK, "v": WARN, "n": MUTE, "bad": BAD}.get(kind, INK)
            prefix = "$ " if kind == "$" else "  "
            for sub in wrap(d, prefix + text, F(MONO, 18), W - 120): d.text((60, y), sub, font=F(MONO, 18), fill=col); y += 26
        frames.append(save(im, f"{name}_{k:03d}.png"))
    return frames, fps

def s_shot(path, name, title, caption):
    im, d = canvas(); header(d, title)
    shot = Image.open(path).convert("RGB"); shot.thumbnail((W - 88, H - 170)); im.paste(shot, (44 + (W - 88 - shot.width) // 2, 92))
    d.text((W // 2, H - 40), caption, font=F(SANS, 20), fill=MUTE, anchor="mm")
    return save(im, name)

def s_contested():
    im, d = canvas(); header(d, "a disputed damage")
    m = CONTESTED; v = [x["verdict"] for x in m["verdicts"]]
    steps = [("lender files", "scratched frame, 30 XRP claimed", MUTE), ("renter", "does not agree", MUTE), ("rules", f"{v[0]['status']} · nothing moves", WARN),
             ("arbiter", "sets 20 XRP (claim capped at 30)", BLUE), ("rules", f"{v[1]['status']} · 2 tranches to lender", BAD), ("deadline", "3 tranches back to renter", OK)]
    y = 120
    for k, t, c in steps:
        d.rounded_rectangle((70, y, 1210, y + 62), 10, fill=CARD, outline=LINE); d.text((95, y + 31), k, font=F(SANS_B, 24), fill=c, anchor="lm"); d.text((330, y + 31), t, font=F(SANS, 24), fill=INK, anchor="lm"); y += 74
    d.text((44, 600), "Silence of the arbiter until CancelAfter = full refund. The ledger does it, not us.", font=F(SANS, 24), fill=MUTE)
    return save(im, "s07.png")

def s_cases():
    im, d = canvas(); header(d, "the judge")
    out = subprocess.run(["node", "--test", "test/"], cwd=ROOT, capture_output=True, text=True).stdout
    names = [l.strip() for l in out.splitlines() if l.strip().startswith("✔")][:30]
    d.text((44, 108), "27 cases written by hand, replayed on every change", font=F(SANS_B, 32), fill=INK)
    col, y = 0, 160
    for n in names:
        d.text((60 + col * 600, y), n.split(" (")[0][:52], font=F(MONO, 16), fill=OK); y += 24
        if y > 600: col += 1; y = 160
    summ = [l.strip("ℹ ").strip() for l in out.splitlines() if l.strip().startswith("ℹ") and ("pass" in l or "fail" in l)]
    d.text((44, 660), "   ".join(summ) + "   ·   src/rules.mjs is a pure function; cases/*.json hold the expected verdict to the drop", font=F(MONO, 18), fill=MUTE)
    return save(im, "s08.png")

def s_limits():
    im, d = canvas(); header(d, "limits, honestly")
    bullets(d, (60, 120), ["Whole tranches, rounded down: up to one tranche of a fair claim is lost to rounding. Smaller tranches = one more transaction and 0.2 XRP of reserve each, returned at the end.",
                           "The oracle is trusted for the keep side only: it can reveal secrets it should not, it can never block your refund. Next: split the secret between oracle and arbiter.",
                           "Native XRP, not euros: token escrows exist on XRPL (XLS-85) but need the issuer's flag; the main euro and dollar issuers had not set it.",
                           "The report is the lender's word, the agreement is the only price list: a lying lender keeps at most what was priced, never more.",
                           "Not legal advice: how such terms could be enforced, not which terms are lawful."], F(SANS, 25), gap=18)
    return save(im, "s09.png")

def s_end():
    im, d = canvas()
    d.text((W // 2, 230), "vienna", font=F(SANS_B, 96), fill=INK, anchor="mm")
    d.text((W // 2, 320), "github.com/LeDenti/vienna", font=F(MONO, 40), fill=BLUE, anchor="mm")
    d.text((W // 2, 420), "built solo, remotely, in 24 hours · MIT · XRP Ledger testnet", font=F(SANS, 26), fill=MUTE, anchor="mm")
    d.text((W // 2, 490), "crypto under the hood, for something people already do every Saturday", font=F(SANS, 26), fill=INK, anchor="mm")
    d.text((W // 2, 620), "proximata × HOIV × START Vienna · Building Better Worlds · Crypto Club Vienna track · matter-x-", font=F(SANS, 17), fill=MUTE, anchor="mm")
    return save(im, "s10.png")

# ---------------------------------------------------------------------------------------- audio
def narrate(i, text):
    aiff = os.path.join(OUT, f"voice{i:02d}.aiff"); wav = os.path.join(OUT, f"voice{i:02d}.wav")
    subprocess.run(["say", "-v", VOICE, "-r", RATE, "-o", aiff, text], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", aiff, "-af", "asetrate=48000*0.97,aresample=48000,atempo=1.0309,equalizer=f=180:t=q:w=1:g=2,equalizer=f=3000:t=q:w=1:g=-1.5", "-ar", "48000", "-ac", "2", wav], check=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav], capture_output=True, text=True).stdout.strip())
    return wav, dur

def seg_still(i, png, wav, dur):
    seg = os.path.join(OUT, f"seg{i:02d}.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", str(FPS), "-i", png, "-i", wav, "-t", f"{dur:.2f}",
                    "-vf", f"fade=t=in:st=0:d=0.4,fade=t=out:st={dur-0.4:.2f}:d=0.4,format=yuv420p", "-af", f"apad,atrim=0:{dur:.2f}",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", seg], check=True)
    return seg

def seg_frames(i, frames, fps, wav, dur):
    """Frames appear at `fps`, then the last one holds until the narration ends."""
    n = len(frames); shown = n / fps; hold = max(0.0, dur - shown)
    lst = os.path.join(OUT, f"frames{i:02d}.txt")
    with open(lst, "w") as f:
        for k, p in enumerate(frames):
            f.write(f"file '{p}'\nduration {(1/fps) if k < n-1 else (1/fps + hold):.3f}\n")
        f.write(f"file '{frames[-1]}'\n")
    seg = os.path.join(OUT, f"seg{i:02d}.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-i", wav, "-t", f"{dur:.2f}",
                    "-vf", f"fps={FPS},fade=t=in:st=0:d=0.4,fade=t=out:st={dur-0.4:.2f}:d=0.4,format=yuv420p", "-af", f"apad,atrim=0:{dur:.2f}",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", seg], check=True)
    return seg

def main():
    os.makedirs(OUT, exist_ok=True)
    script = [l for l in open(os.path.join(HERE, "script.md")).read().splitlines() if re.match(r"^\| \d+ \|", l)]
    narr = [l.split("|")[3].strip() for l in script]
    scenes = [("still", s_title()), ("still", s_problem()), ("still", s_how()), ("still", s_agreement()),
              ("frames", s_terminal(LATE, "term_late", "a real run on the testnet: late, charger missing")),
              ("still", s_shot(os.path.join(OUT, "dashboard.png"), "s05.png", "the dashboard", "npm run serve · every square links to its transaction on testnet.xrpl.org")),
              ("still", s_shot(os.path.join(OUT, "explorer_finish.png"), "s06.png", "on the public explorer", "EscrowFinish " + LATE["finish"][0]["hash"][:16] + "… · condition and fulfilment revealed by the oracle")),
              ("still", s_contested()), ("still", s_cases()), ("still", s_limits()), ("still", s_end())]
    segs, total = [], 0.0
    for i, ((kind, art), text) in enumerate(zip(scenes, narr)):
        wav, vdur = narrate(i, text); dur = math.ceil((vdur + PAUSE) * 10) / 10
        segs.append(seg_still(i, art, wav, dur) if kind == "still" else seg_frames(i, art[0], art[1], wav, dur))
        total += dur; print(f"scene {i:2d} {dur:5.1f}s  ({total:5.1f}s)  {text[:60]}")
    lst = os.path.join(OUT, "list.txt")
    with open(lst, "w") as f:
        for s in segs: f.write(f"file '{s}'\n")
    final = os.path.join(OUT, "vienna_demo_EN.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", final], check=True)
    print(f"→ {final}  {total:.1f}s")

if __name__ == "__main__":
    main()
