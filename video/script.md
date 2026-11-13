# vienna — demo video script (3 min, English, synthesized voice "Samantha")

Scenes and narration, as rendered by `video/make.py`. Everything shown in the terminal and the
dashboard scenes comes from real testnet runs (`measures/*.json`), nothing typed by hand.

| # | Scene | Narration |
|---|---|---|
| 0 | Title | This is vienna. A deposit you get back automatically. |
| 1 | Problem | Rent an e-bike for a Saturday in Vienna and the shop blocks two hundred euros on your card, sometimes for a week. No credit card, no bike. A scratch at the end, and it becomes a chargeback fight nobody wins. |
| 2 | How it works | With vienna, the deposit sits on the XRP Ledger as five escrows of ten. Each one has two locks. A secret held by the oracle: only the written rules can move a tranche to the shop. And a deadline written in the ledger itself: once it passes, anyone can send the rest back to you. The refund needs nobody's goodwill. Not the shop's. Not ours. |
| 3 | Agreement | Everything the shop could ever keep is priced before the key changes hands. The late fee per hour and its cap. Each accessory. Cleaning. And the name of an arbiter, for a damage the renter disputes. |
| 4 | Terminal, real run | This run happened on the testnet. The renter locks five tranches. He comes back late, without the charger, and the shop also claims a basket that was never in the agreement. The rules keep ten for the hour late and fifteen for the charger. Twenty-five, rounded down to two whole tranches. The basket is worth zero: not found beats guessed. Two escrows finish to the shop. After the deadline, the other three are cancelled back to the renter. No escrow left. |
| 5 | Dashboard | The dashboard shows every tranche. Red went to the shop. Green came back. Each square is a link to its transaction. |
| 6 | Explorer | Here is one of them on the public explorer: an escrow finish, with the condition, and the fulfilment the oracle revealed. |
| 7 | Contested | When the shop claims a scratch and the renter disagrees, nothing moves. The arbiter named in the agreement sets twenty. Two tranches go, three come back. Had the arbiter stayed silent until the deadline, everything would have come back. Silence means refund. |
| 8 | Case file | The rules are a pure function, one screen long. Their judge is a case file: twenty-seven cases written by hand, replayed on every change. Plus a differential test of the crypto-condition encoder against an independent library. |
| 9 | Limits | Limits, honestly. Whole tranches: up to one tranche of a fair claim is lost to rounding. The oracle is trusted for what the shop keeps, never for your refund. Native XRP, not euros: euro tokens on this ledger still need their issuer's flag to be escrowed. And none of this is legal advice. |
| 10 | End | vienna. Crypto under the hood, for something people already do every Saturday. Built solo, remotely, in twenty-four hours. github dot com, slash LeDenti, slash vienna. |
