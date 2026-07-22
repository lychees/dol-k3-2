"""Integration test: boot the server, exercise the full packet flow.

    register -> login -> whoami -> player.save -> player.load -> errors
"""
import asyncio
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import websockets

from app import config
from app.net.server import GameServer
from main import build_container

PORT = 8791
URL = f"ws://127.0.0.1:{PORT}"
results = []


def check(name, cond):
    results.append((name, cond))
    print(("OK  " if cond else "FAIL"), name)


class Client:
    def __init__(self):
        self.seq = 0
        self.ws = None

    async def __aenter__(self):
        self.ws = await websockets.connect(URL)
        return self

    async def __aexit__(self, *exc):
        await self.ws.close()

    async def call(self, type_, payload=None, token=None):
        self.seq += 1
        pkt = {"v": 1, "type": type_, "seq": self.seq, "payload": payload or {}}
        if token:
            pkt["token"] = token
        await self.ws.send(json.dumps(pkt))
        return json.loads(await self.ws.recv())


async def main():
    db_path = os.path.join(tempfile.mkdtemp(), "test.db")
    container = build_container(db_path)
    server = container.resolve(GameServer)

    async with websockets.serve(server._handle_conn, "127.0.0.1", PORT):
        async with Client() as c:
            # register
            r = await c.call("auth.register", {"username": "tester", "password": "pw1234"})
            check("register ok", r["type"] == "auth.register.ok" and r["payload"]["username"] == "tester")

            # duplicate registration fails
            r = await c.call("auth.register", {"username": "tester", "password": "pw1234"})
            check("duplicate register rejected", r["type"] == "error" and r["payload"]["code"] == "username_taken")

            # wrong password
            r = await c.call("auth.login", {"username": "tester", "password": "wrong"})
            check("wrong password rejected", r["payload"]["code"] == "bad_credentials")

            # login
            r = await c.call("auth.login", {"username": "tester", "password": "pw1234"})
            token = r["payload"].get("token")
            check("login returns token", r["type"] == "auth.login.ok" and token)

            # whoami without token -> unauthorized
            r = await c.call("auth.whoami")
            check("whoami without token rejected", r["payload"]["code"] == "unauthorized")

            # whoami with token
            r = await c.call("auth.whoami", token=token)
            check("whoami ok", r["type"] == "auth.whoami.ok" and r["payload"]["username"] == "tester")

            # fresh player data is the documented starting state
            r = await c.call("player.load", token=token)
            data = r["payload"]["data"]
            check("fresh player data", data["gold"] == 1000 and data["fleet"][0]["ship"] == "Balsa")

            # save a modified state (fleet + discoveries + mates + wealth)
            data["gold"] = 54321
            data["fleet"].append({"ship": "Galleon", "hull": 160})
            data["discoveries"] = [48, 99]
            data["mates"] = [1, 2]
            r = await c.call("player.save", {"data": data}, token=token)
            check("player.save ok", r["type"] == "player.save.ok")

            # reload from a second connection (proves persistence)
            async with Client() as c2:
                r = await c2.call("auth.login", {"username": "tester", "password": "pw1234"})
                token2 = r["payload"]["token"]
                r = await c2.call("player.load", token=token2)
                d = r["payload"]["data"]
                check("persisted gold", d["gold"] == 54321)
                check("persisted fleet", len(d["fleet"]) == 2 and d["fleet"][1]["ship"] == "Galleon")
                check("persisted discoveries", d["discoveries"] == [48, 99])
                check("persisted mates", d["mates"] == [1, 2])

            # plugin-discovered misc handlers work (proof of the extension pattern)
            r = await c.call("server.ping")
            check("server.ping (plugin module)", r["type"] == "server.ping.ok")
            r = await c.call("server.types")
            check("server.types lists all", "player.load" in r["payload"]["types"]
                  and "server.ping" in r["payload"]["types"])

            # unknown packet type
            r = await c.call("fishing.cast")
            check("unknown type rejected", r["payload"]["code"] == "unknown_type")

            # malformed frame
            await c.ws.send("not json at all")
            r = json.loads(await c.ws.recv())
            check("bad frame rejected", r["payload"]["code"] == "bad_packet")

            # seq echoed
            r = await c.call("auth.whoami", token=token)
            check("seq echoed", r["seq"] == c.seq)

    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return passed == len(results)


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
