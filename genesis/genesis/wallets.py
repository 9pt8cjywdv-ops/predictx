"""Wallet address and network validation (no private keys are ever handled here)."""
from .errors import PolicyViolation

# Native USDC contract / mint addresses. Re-verify against Circle's official
# list (https://developers.circle.com/stablecoins/usdc-contract-addresses)
# before enabling live mode.
NETWORKS = {
    "base": {"family": "evm", "chain_id": 8453, "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},
    "ethereum": {"family": "evm", "chain_id": 1, "usdc": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"},
    "arbitrum": {"family": "evm", "chain_id": 42161, "usdc": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"},
    "optimism": {"family": "evm", "chain_id": 10, "usdc": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"},
    "polygon": {"family": "evm", "chain_id": 137, "usdc": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"},
    "solana": {"family": "solana", "chain_id": None, "usdc": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},
}

# ---------------------------------------------------------------- keccak-256
_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
_ROT = [
    [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
]
_M = (1 << 64) - 1


def _rol(x: int, n: int) -> int:
    n %= 64
    return ((x << n) | (x >> (64 - n))) & _M


def _keccak_f(a: list[list[int]]) -> None:
    for rc in _RC:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x][y] ^= d[x]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(a[x][y], _ROT[x][y])
        for x in range(5):
            for y in range(5):
                a[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y])
        a[0][0] ^= rc


def keccak256(data: bytes) -> bytes:
    rate = 136
    msg = bytearray(data)
    msg.append(0x01)
    while len(msg) % rate:
        msg.append(0)
    msg[-1] |= 0x80
    state = [[0] * 5 for _ in range(5)]
    for off in range(0, len(msg), rate):
        block = msg[off : off + rate]
        for i in range(rate // 8):
            state[i % 5][i // 5] ^= int.from_bytes(block[8 * i : 8 * i + 8], "little")
        _keccak_f(state)
    out = b"".join(state[i % 5][i // 5].to_bytes(8, "little") for i in range(4))
    return out


def to_checksum_address(addr: str) -> str:
    body = addr.lower().removeprefix("0x")
    h = keccak256(body.encode()).hex()
    return "0x" + "".join(ch.upper() if ch.isalpha() and int(h[i], 16) >= 8 else ch for i, ch in enumerate(body))


# ---------------------------------------------------------------- base58
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        idx = _B58.find(ch)
        if idx < 0:
            raise ValueError("invalid base58 character")
        n = n * 58 + idx
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * pad + raw


# ---------------------------------------------------------------- validation
def validate_address(address: str, network: str) -> str:
    """Return the canonical form of a valid address or raise PolicyViolation."""
    if network not in NETWORKS:
        raise PolicyViolation(f"unsupported network {network!r}; choose one of {sorted(NETWORKS)}")
    if not isinstance(address, str):
        raise PolicyViolation("address must be a string")
    address = address.strip()
    family = NETWORKS[network]["family"]
    if family == "evm":
        body = address.removeprefix("0x")
        if not address.startswith("0x") or len(body) != 40 or any(c not in "0123456789abcdefABCDEF" for c in body):
            raise PolicyViolation("invalid EVM address: expected 0x followed by 40 hex characters")
        if int(body, 16) == 0:
            raise PolicyViolation("refusing the zero address")
        checksummed = to_checksum_address(address)
        mixed = body != body.lower() and body != body.upper()
        if mixed and address != checksummed:
            raise PolicyViolation("EVM address fails EIP-55 checksum (possible typo)")
        if address.lower() in {v["usdc"].lower() for v in NETWORKS.values() if v["family"] == "evm"}:
            raise PolicyViolation("that is the USDC token contract, not a wallet")
        return checksummed
    try:
        raw = b58decode(address)
    except ValueError as exc:
        raise PolicyViolation("invalid Solana address (base58)") from exc
    if len(raw) != 32:
        raise PolicyViolation("invalid Solana address: must decode to 32 bytes")
    if address == NETWORKS["solana"]["usdc"]:
        raise PolicyViolation("that is the USDC mint, not a wallet")
    return address
