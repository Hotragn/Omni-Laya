"""Deploys Laya to Modal and writes its address and key into omnilaya-secrets.env.

    pip install modal
    python deploy/modal/deploy.py                 # CPU, scales to zero (fits Modal's free monthly credit)
    python deploy/modal/deploy.py --gpu T4        # GPU: searches as fast as Jev Search, uses credit faster
    python deploy/modal/deploy.py --gpu T4 --warm 1 --idle 900

`--warm N` keeps N containers running so nobody waits for a cold start, and costs
money all the time it runs. The first run opens a browser to sign in to Modal.
Then run: pnpm deploy:free ./omnilaya-secrets.env
"""
import argparse
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
APP = os.path.join(HERE, "laya_modal.py")


def read_env(path):
    values = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                values[m.group(1)] = m.group(2)
    return values


def write_env(path, values):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for key, value in values.items():
            f.write(f"{key}={value}\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def modal_cmd():
    exe = shutil.which("modal")
    return [exe] if exe else [sys.executable, "-m", "modal"]


def wait_for_health(url, timeout=900):
    """The first request builds the image and loads Laya, which can take several minutes."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=120) as res:
                if res.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(10)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gpu", default="", help="Modal GPU type such as T4 or L4; empty for CPU")
    parser.add_argument("--warm", type=int, default=0, help="containers kept running (0 scales to zero)")
    parser.add_argument("--idle", type=int, default=300, help="seconds idle before a container stops")
    parser.add_argument("--max", type=int, default=2, help="most containers at once")
    parser.add_argument("--secrets", default=os.path.join(ROOT, "omnilaya-secrets.env"), help="secrets file to update")
    args = parser.parse_args()

    env_file = read_env(args.secrets)
    key = env_file.get("LAYA_API_KEY") or secrets.token_hex(32)

    check = subprocess.run(modal_cmd() + ["token", "info"], capture_output=True, text=True)
    if check.returncode != 0:
        print("==> Signing in to Modal (a browser window opens)")
        subprocess.run(modal_cmd() + ["setup"], check=True)

    print(f"==> Deploying Laya to Modal ({args.gpu or 'CPU'}, warm={args.warm}, idle={args.idle}s)")
    env = dict(os.environ, LAYA_API_KEY=key, LAYA_GPU=args.gpu, LAYA_MIN_CONTAINERS=str(args.warm),
               LAYA_MAX_CONTAINERS=str(args.max), LAYA_SCALEDOWN=str(args.idle))
    result = subprocess.run(modal_cmd() + ["deploy", APP], env=env, capture_output=True, text=True, cwd=ROOT)
    print(result.stdout[-3000:])
    if result.returncode != 0:
        print(result.stderr[-3000:], file=sys.stderr)
        sys.exit("modal deploy failed")
    url = next(iter(re.findall(r"https://[\w.-]+\.modal\.run", result.stdout + result.stderr)), None)
    if not url:
        sys.exit("Deployed, but could not find the endpoint address in Modal's output")

    print(f"==> Waiting for {url}/health (first start builds and loads the model)")
    if not wait_for_health(url):
        sys.exit("Laya did not answer; check the app logs in the Modal dashboard")

    env_file.update({"LAYA_PROVIDERS": "laya", "LAYA_BASE_URL": url, "LAYA_API_KEY": key})
    if "SEARCH_PROVIDER" not in env_file:
        env_file["SEARCH_PROVIDER"] = "search1api"
        env_file.setdefault("SEARCH1API_API_KEY", "")
    write_env(args.secrets, env_file)
    print(f"==> Laya is live at {url}. Wrote {args.secrets}.")
    if env_file.get("SEARCH_PROVIDER") == "search1api" and not env_file.get("SEARCH1API_API_KEY"):
        print("    Add your Search1API key to SEARCH1API_API_KEY in that file, then run: pnpm deploy:free ./omnilaya-secrets.env")
    else:
        print("    Next: pnpm deploy:free ./omnilaya-secrets.env")


if __name__ == "__main__":
    main()
