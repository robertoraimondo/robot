import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import winreg
except ImportError:
    winreg = None


ROOT = Path(__file__).resolve().parent
APP_CATALOG = None


def normalize_app_key(name):
    cleaned = Path(str(name)).stem.lower()
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^microsoft\s+", "", cleaned)
    return cleaned


def _scan_start_menu_shortcuts():
    candidates = []
    roots = [
        Path(os.environ.get("ProgramData", "")) / "Microsoft/Windows/Start Menu/Programs",
        Path(os.environ.get("AppData", "")) / "Microsoft/Windows/Start Menu/Programs",
    ]
    for root in roots:
        if not root or not root.exists():
            continue
        for extension in ("*.lnk", "*.url"):
            candidates.extend(root.rglob(extension))
    return candidates


def _scan_registry_app_paths():
    if winreg is None:
        return []

    paths = []
    roots = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
    ]

    for hive, root_path in roots:
        try:
            with winreg.OpenKey(hive, root_path) as root_key:
                subkey_count = winreg.QueryInfoKey(root_key)[0]
                for i in range(subkey_count):
                    subkey_name = winreg.EnumKey(root_key, i)
                    try:
                        with winreg.OpenKey(root_key, subkey_name) as app_key:
                            value, _ = winreg.QueryValueEx(app_key, None)
                            if value:
                                paths.append(Path(value))
                    except OSError:
                        continue
        except OSError:
            continue

    return paths


def build_app_catalog():
    catalog = {}

    for shortcut in _scan_start_menu_shortcuts():
        key = normalize_app_key(shortcut.stem)
        if not key:
            continue
        if key not in catalog:
            catalog[key] = {
                "display": shortcut.stem,
                "target": str(shortcut),
            }

    for app_path in _scan_registry_app_paths():
        key = normalize_app_key(app_path.stem)
        if not key:
            continue
        if key not in catalog:
            catalog[key] = {
                "display": app_path.stem,
                "target": str(app_path),
            }

    return catalog


def get_app_catalog():
    global APP_CATALOG
    if APP_CATALOG is None:
        APP_CATALOG = build_app_catalog()
    return APP_CATALOG


def resolve_catalog_app(app_name):
    key = normalize_app_key(app_name)
    if not key:
        return None

    catalog = get_app_catalog()
    if key in catalog:
        return catalog[key]

    # Best-effort partial match with shortest candidate name.
    matches = [entry for entry_key, entry in catalog.items() if key in entry_key]
    if not matches:
        return None
    return sorted(matches, key=lambda entry: len(entry["display"]))[0]


def open_target(target):
    try:
        os.startfile(target)
        return True
    except OSError:
        return False


def open_first_available(targets):
    for target in targets:
        if open_target(target):
            return True
    return False


def start_process(args):
    try:
        subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError:
        return False


def open_url_in_edge(url):
    if start_process(["cmd", "/c", "start", "", "msedge", url]):
        return True
    if open_target(f"microsoft-edge:{url}"):
        return True
    return webbrowser.open(url)


def find_outlook_exe():
    candidates = []
    found = shutil.which("outlook") or shutil.which("OUTLOOK.EXE")
    if found:
        candidates.append(found)

    program_roots = [
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("LocalAppData"),
    ]
    relative_paths = [
        r"Microsoft Office\root\Office16\OUTLOOK.EXE",
        r"Microsoft Office\Office16\OUTLOOK.EXE",
        r"Microsoft Office\Office15\OUTLOOK.EXE",
        r"Microsoft Office\Office14\OUTLOOK.EXE",
        r"Microsoft\WindowsApps\olk.exe",
        r"Microsoft\WindowsApps\outlook.exe",
    ]

    for root in program_roots:
        if not root:
            continue
        for relative in relative_paths:
            candidates.append(str(Path(root) / relative))

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def open_outlook():
    outlook = find_outlook_exe()
    if outlook:
        return start_process([outlook])

    if open_target("outlook:"):
        return True

    return start_process(["cmd", "/c", "start", "", "outlook"])


def make_letter(command, user_name="Roy"):
    name_match = re.search(r"(?:to|for)\s+([a-z][a-z .'-]{1,40})", command, re.I)
    recipient = name_match.group(1).strip().title() if name_match else "Recipient"
    today = datetime.now().strftime("%B %d, %Y")
    body = (
        r"{\rtf1\ansi\deff0"
        rf"\b {today}\b0\par\par"
        rf"Dear {recipient},\par\par"
        r"I am writing this letter for you from Lee, your local AI robot assistant.\par\par"
        r"Please edit this draft with the exact message you want to send.\par\par"
        r"Sincerely,\par"
        rf"{user_name or 'Roy'}\par"
        r"}"
    )
    out_dir = Path(tempfile.gettempdir()) / "aiva_robot"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / "AIVA_Letter_Draft.rtf"
    path.write_text(body, encoding="utf-8")
    if not open_target(str(path)):
        return False, "I created the letter draft, but I could not open it."
    return True, f"I wrote a letter draft for {recipient} and opened it."


def open_email(command):
    to_match = re.search(r"(?:to|for)\s+([\w.+-]+@[\w.-]+\.\w+)", command, re.I)
    subject = "Message from Lee"
    body = "Hello,\n\nI am drafting this email with Lee.\n\n"
    address = to_match.group(1) if to_match else ""
    compose_url = (
        "https://outlook.live.com/mail/deeplink/compose"
        f"?to={urllib.parse.quote(address)}"
        f"&subject={urllib.parse.quote(subject)}"
        f"&body={urllib.parse.quote(body)}"
    )
    open_url_in_edge(compose_url)
    if address:
        return True, f"I opened an email draft to {address}."
    return True, "I opened a new email draft."


def clean_query(command, prefixes):
    text = command.strip()
    lowered = text.lower()
    for prefix in prefixes:
        if lowered.startswith(prefix):
            return text[len(prefix):].strip(" .")
    return text


def web_search(query):
    encoded = urllib.parse.quote_plus(query)
    open_url_in_edge(f"https://www.google.com/search?q={encoded}")
    return True, f"I searched the web for {query}."


def extract_search_query(command):
    match = re.search(r"(?:search(?:\s+the\s+web)?(?:\s+for)?|google|look\s*up|find)\s+(.+)", command, re.I)
    if not match:
        return ""

    query = match.group(1).strip(" .")
    query = re.sub(r"\bon\s+google\b", "", query, flags=re.I).strip(" .")
    return query


def map_search(query):
    encoded = urllib.parse.quote_plus(query)
    open_url_in_edge(f"https://www.google.com/maps/search/{encoded}")
    return True, f"I opened a map search for {query}."


def normalize_app_name(text):
    app = text.strip().lower()
    app = re.sub(r"^(?:open|start|launch|close|quit|exit|stop)\s+", "", app)
    app = re.sub(r"\s+app$", "", app).strip()
    aliases = {
        "team": "teams",
        "file explorer": "explorer",
        "email": "outlook",
        "emails": "outlook",
        "e-mail": "outlook",
        "e-mails": "outlook",
        "mail": "outlook",
        "gmail": "outlook",
        "inbox": "outlook",
        "out look": "outlook",
        "out lock": "outlook",
        "outlook email": "outlook",
        "web browser": "browser",
    }
    return aliases.get(app, app)


def kill_processes(process_names):
    killed_any = False
    for process_name in process_names:
        result = subprocess.run(
            ["taskkill", "/IM", process_name, "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode == 0:
            killed_any = True
    return killed_any


def close_catalog_app(app_name):
    entry = resolve_catalog_app(app_name)
    if not entry:
        return False, ""

    candidates = set()
    normalized = normalize_app_key(app_name).replace(" ", "")
    if normalized:
        candidates.add(f"{normalized}.exe")

    target_path = Path(entry["target"])
    if target_path.suffix.lower() == ".exe":
        candidates.add(target_path.name)

    stem = normalize_app_key(entry["display"]).replace(" ", "")
    if stem:
        candidates.add(f"{stem}.exe")
        for part in stem.split():
            if len(part) > 2:
                candidates.add(f"{part}.exe")

    killed = kill_processes(sorted(candidates))
    if killed:
        return True, f"I closed {entry['display']}."
    return False, f"I could not find an open {entry['display']} window."


def open_catalog_app(app_name):
    entry = resolve_catalog_app(app_name)
    if not entry:
        return False, ""

    if open_target(entry["target"]):
        return True, f"I opened {entry['display']}."
    return False, f"I found {entry['display']}, but I could not open it."


def open_named_app(app_name):
    if app_name == "word":
        ok = open_first_available(("winword", "WINWORD.EXE"))
        if not ok:
            ok = start_process(["cmd", "/c", "start", "", "winword"])
        return ok, "I opened Microsoft Word." if ok else "I could not find Microsoft Word."

    if app_name == "excel":
        ok = open_first_available(("excel", "EXCEL.EXE"))
        if not ok:
            ok = start_process(["cmd", "/c", "start", "", "excel"])
        return ok, "I opened Microsoft Excel." if ok else "I could not find Microsoft Excel."

    if app_name == "teams":
        if open_target("msteams:"):
            return True, "I opened Microsoft Teams."
        ok = start_process(["cmd", "/c", "start", "", "ms-teams:"])
        return ok, "I opened Microsoft Teams." if ok else "I could not open Microsoft Teams."

    if app_name == "outlook":
        ok = open_outlook()
        if ok:
            return True, "I opened Outlook."
        open_url_in_edge("https://outlook.live.com/mail/")
        return True, "I opened Outlook on the web."

    if app_name == "notepad":
        ok = start_process(["notepad.exe"])
        return ok, "I opened Notepad." if ok else "I could not open Notepad."

    if app_name == "explorer":
        ok = start_process(["explorer.exe"])
        return ok, "I opened File Explorer." if ok else "I could not open File Explorer."

    if app_name in ("browser", "chrome"):
        open_url_in_edge("https://www.google.com")
        return True, "I opened the browser."

    ok, message = open_catalog_app(app_name)
    if message:
        return ok, message

    return False, ""


def close_named_app(app_name):
    process_map = {
        "word": ["WINWORD.EXE"],
        "excel": ["EXCEL.EXE"],
        "teams": ["ms-teams.exe", "Teams.exe"],
        "outlook": ["OUTLOOK.EXE", "olk.exe"],
        "notepad": ["notepad.exe"],
        "explorer": ["explorer.exe"],
        "browser": ["chrome.exe", "msedge.exe", "firefox.exe"],
        "chrome": ["chrome.exe"],
    }

    process_names = process_map.get(app_name)
    if not process_names:
        return False, ""

    killed = kill_processes(process_names)
    pretty_name = {
        "word": "Word",
        "excel": "Excel",
        "teams": "Teams",
        "outlook": "Outlook",
        "notepad": "Notepad",
        "explorer": "File Explorer",
        "browser": "browser",
        "chrome": "Chrome",
    }.get(app_name, app_name)

    if killed:
        return True, f"I closed {pretty_name}."
    if process_names:
        return False, f"I could not find an open {pretty_name} window."

    ok, message = close_catalog_app(app_name)
    if message:
        return ok, message

    return False, ""


def run_command(command, user_name="Roy"):
    text = command.lower().strip()

    if text in ("list installed apps", "list installed applications", "show installed apps"):
        names = sorted(entry["display"] for entry in get_app_catalog().values())
        preview = ", ".join(names[:20]) if names else "none"
        extra = "" if len(names) <= 20 else f" and {len(names) - 20} more"
        return True, f"I found {len(names)} installed apps. Examples: {preview}{extra}."

    close_match = re.match(r"^(?:close|quit|exit|stop)\s+(.+)$", text)
    if close_match:
        close_app = normalize_app_name(close_match.group(1))
        ok, message = close_named_app(close_app)
        if message:
            return ok, message

    if any(phrase in text for phrase in ("write a letter", "draft a letter", "create a letter")):
        return make_letter(command, user_name)

    if any(phrase in text for phrase in ("read my emails", "read emails", "check my emails", "check email", "check emails", "open my email", "open inbox")) or re.fullmatch(r"(?:e-?mails?|mail|gmail|inbox)", text):
        if open_outlook():
            return True, "I opened your email. Reading messages requires an authorized mail connector."
        open_url_in_edge("https://outlook.live.com/mail/")
        return True, "I opened Outlook on the web. Reading messages requires an authorized mail connector."

    if any(phrase in text for phrase in ("write an email", "send an email", "open email", "draft email")):
        return open_email(command)

    if text.startswith("search the web for ") or text.startswith("search web for ") or text.startswith("google "):
        query = clean_query(command, ("search the web for ", "search web for ", "google "))
        return web_search(query or "Lee assistant")

    search_query = extract_search_query(command)
    if search_query:
        return web_search(search_query)

    open_match = re.match(r"^(?:open|start|launch)\s+(.+)$", text)
    if open_match:
        open_app = normalize_app_name(open_match.group(1))
        ok, message = open_named_app(open_app)
        if message:
            return ok, message

    direct_app = normalize_app_name(text)
    ok, message = open_named_app(direct_app)
    if message:
        return ok, message

    if "open word" in text or text == "word":
        ok = open_first_available(("winword", "WINWORD.EXE"))
        if not ok:
            ok = start_process(["cmd", "/c", "start", "", "winword"])
        return ok, "I opened Microsoft Word." if ok else "I could not find Microsoft Word."

    if "open teams" in text or "open team" in text or text == "teams":
        if open_target("msteams:"):
            return True, "I opened Microsoft Teams."
        ok = start_process(["cmd", "/c", "start", "", "ms-teams:"])
        return ok, "I opened Microsoft Teams." if ok else "I could not open Microsoft Teams."

    if "open outlook" in text or text == "outlook":
        ok = open_outlook()
        return ok, "I opened Outlook." if ok else "I could not find Outlook."

    if "open notepad" in text or text == "notepad":
        ok = start_process(["notepad.exe"])
        return ok, "I opened Notepad." if ok else "I could not open Notepad."

    if "open file explorer" in text or "open explorer" in text or text == "explorer":
        ok = start_process(["explorer.exe"])
        return ok, "I opened File Explorer." if ok else "I could not open File Explorer."

    if "open browser" in text or "open chrome" in text:
        open_url_in_edge("https://www.google.com")
        return True, "I opened the browser."

    return False, "I can animate that command, but desktop control is only enabled for Word, Teams, Outlook, email drafts, letter drafts, Notepad, and browser."


class RobotHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        if self.path != "/api/command":
            self.send_error(404)
            return

        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(400)
            return

        ok, message = run_command(str(payload.get("command", "")), str(payload.get("userName", "Roy")))
        data = json.dumps({"ok": ok, "message": message}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(os.environ.get("PORT", "5180"))
    server = ThreadingHTTPServer(("127.0.0.1", port), RobotHandler)
    print(f"Lee robot server running at http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
