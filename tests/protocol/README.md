# Protocol test dependencies

Install the protocol-oracle dependency with:

```text
python -m pip install -r tests/protocol/requirements.txt
```

`rfc8785` is scoped to the Python reference/oracle and produces the RFC 8785 JCS UTF-8 bytes used by canonical package identity. Runtime dependencies remain separate.

Derived fixture hashes must be regenerated with:

```text
python -m tests.protocol.regenerate_canonical_hashes
```
