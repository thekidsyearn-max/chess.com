// ECO opening encyclopedia: all 500 codes A00–E99 followed by popular named lines.
// Format per line:  CODE|Name|moves in SAN
// "^CODE" at the start of the moves expands to the first line listed for that code.
export const ECO_TEXT = `
A00|Polish Opening|b4
A01|Nimzowitsch-Larsen Attack|b3
A02|Bird's Opening|f4
A03|Bird's Opening: Dutch Variation|f4 d5
A04|Réti Opening|Nf3
A05|Réti Opening: 1...Nf6|Nf3 Nf6
A06|Réti Opening: 1...d5|Nf3 d5
A07|King's Indian Attack|Nf3 d5 g3
A08|King's Indian Attack: Sicilian Variation|Nf3 d5 g3 c5 Bg2
A09|Réti Opening: Réti Gambit|Nf3 d5 c4
A10|English Opening|c4
A11|English Opening: Caro-Kann Defensive System|c4 c6
A12|English Opening: Caro-Kann Defensive System, Bogoljubov Variation|c4 c6 Nf3 d5 b3
A13|English Opening: Agincourt Defense|c4 e6
A14|English Opening: Neo-Catalan Declined|c4 e6 Nf3 d5 g3 Nf6 Bg2 Be7 O-O
A15|English Opening: Anglo-Indian Defense|c4 Nf6
A16|English Opening: Anglo-Indian Defense, Queen's Knight Variation|c4 Nf6 Nc3
A17|English Opening: Anglo-Indian Defense, Hedgehog System|c4 Nf6 Nc3 e6
A18|English Opening: Mikenas-Carls Variation|c4 Nf6 Nc3 e6 e4
A19|English Opening: Mikenas-Carls, Sicilian Variation|c4 Nf6 Nc3 e6 e4 c5
A20|English Opening: King's English Variation|c4 e5
A21|English Opening: King's English, Reversed Sicilian|c4 e5 Nc3
A22|English Opening: King's English, Two Knights Variation|c4 e5 Nc3 Nf6
A23|English Opening: Bremen System, Keres Variation|c4 e5 Nc3 Nf6 g3 c6
A24|English Opening: Bremen System with ...g6|c4 e5 Nc3 Nf6 g3 g6
A25|English Opening: King's English, Reversed Closed Sicilian|c4 e5 Nc3 Nc6
A26|English Opening: Closed System, Botvinnik Line|c4 e5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6
A27|English Opening: Three Knights System|c4 e5 Nc3 Nc6 Nf3
A28|English Opening: Four Knights System|c4 e5 Nc3 Nc6 Nf3 Nf6
A29|English Opening: Four Knights, Kingside Fianchetto|c4 e5 Nc3 Nc6 Nf3 Nf6 g3
A30|English Opening: Symmetrical Variation|c4 c5
A31|English Opening: Symmetrical, Benoni Formation|c4 c5 Nf3 Nf6 d4
A32|English Opening: Symmetrical, Two Knights Line|^A31 cxd4 Nxd4 e6
A33|English Opening: Symmetrical, Geller Variation|^A32 Nc3 Nc6
A34|English Opening: Symmetrical, Normal Variation|c4 c5 Nc3
A35|English Opening: Symmetrical, Two Knights|c4 c5 Nc3 Nc6
A36|English Opening: Symmetrical, Fianchetto Variation|c4 c5 Nc3 Nc6 g3
A37|English Opening: Symmetrical, Two Knights Fianchetto|c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3
A38|English Opening: Symmetrical, Full Symmetry Line|^A37 Nf6
A39|English Opening: Symmetrical, Mecking Variation|^A38 O-O O-O d4
A40|Queen's Pawn Game|d4
A41|Queen's Pawn Game: Wade Defense|d4 d6
A42|Modern Defense: Averbakh System|d4 d6 c4 g6 Nc3 Bg7 e4
A43|Old Benoni Defense|d4 c5
A44|Old Benoni Defense: Czech System|d4 c5 d5 e5
A45|Indian Defense|d4 Nf6
A46|Indian Defense: Knights Variation|d4 Nf6 Nf3
A47|Queen's Indian Defense: Marienbad System|d4 Nf6 Nf3 b6
A48|East Indian Defense|d4 Nf6 Nf3 g6
A49|East Indian Defense: Fianchetto without c4|d4 Nf6 Nf3 g6 g3
A50|Indian Defense: Normal Variation|d4 Nf6 c4
A51|Budapest Gambit|d4 Nf6 c4 e5
A52|Budapest Gambit: Main Line|d4 Nf6 c4 e5 dxe5 Ng4
A53|Old Indian Defense|d4 Nf6 c4 d6
A54|Old Indian Defense: Ukrainian Variation|d4 Nf6 c4 d6 Nc3 e5 Nf3
A55|Old Indian Defense: Main Line|^A54 Nbd7 e4
A56|Benoni Defense|d4 Nf6 c4 c5
A57|Benko Gambit|d4 Nf6 c4 c5 d5 b5
A58|Benko Gambit Accepted|^A57 cxb5 a6 bxa6
A59|Benko Gambit Accepted: 7.e4|^A58 Bxa6 Nc3 d6 e4
A60|Benoni Defense: Modern Variation|d4 Nf6 c4 c5 d5 e6
A61|Benoni Defense: Knight's Tour Setup|^A60 Nc3 exd5 cxd5 d6 Nf3 g6
A62|Benoni Defense: Fianchetto Variation|^A61 g3 Bg7 Bg2 O-O
A63|Benoni Defense: Fianchetto, 9...Nbd7|^A62 O-O Nbd7
A64|Benoni Defense: Fianchetto, 11...Re8|^A63 Nd2 a6 a4 Re8
A65|Benoni Defense: 6.e4|^A60 Nc3 exd5 cxd5 d6 e4
A66|Benoni Defense: Pawn Storm Variation|^A65 g6 f4
A67|Benoni Defense: Taimanov Variation|^A66 Bg7 Bb5+
A68|Benoni Defense: Four Pawns Attack|^A66 Bg7 Nf3 O-O
A69|Benoni Defense: Four Pawns Attack, Main Line|^A68 Be2 Re8
A70|Benoni Defense: Classical with 7.Nf3|^A65 g6 Nf3
A71|Benoni Defense: Classical, 8.Bg5|^A70 Bg7 Bg5
A72|Benoni Defense: Classical without 9.O-O|^A70 Bg7 Be2 O-O
A73|Benoni Defense: Classical, 9.O-O|^A72 O-O
A74|Benoni Defense: Classical, 9...a6 10.a4|^A73 a6 a4
A75|Benoni Defense: Classical, Argentine Counterattack|^A74 Bg4
A76|Benoni Defense: Classical, 9...Re8|^A73 Re8
A77|Benoni Defense: Classical, 9...Re8 10.Nd2|^A76 Nd2
A78|Benoni Defense: Classical with ...Re8 and ...Na6|^A77 Na6
A79|Benoni Defense: Classical, 11.f3|^A78 f3
A80|Dutch Defense|d4 f5
A81|Dutch Defense: Fianchetto Attack|d4 f5 g3
A82|Dutch Defense: Staunton Gambit|d4 f5 e4
A83|Dutch Defense: Staunton Gambit, Staunton's Line|d4 f5 e4 fxe4 Nc3 Nf6 Bg5
A84|Dutch Defense: Normal Variation|d4 f5 c4
A85|Dutch Defense: Queen's Knight Variation|d4 f5 c4 Nf6 Nc3
A86|Dutch Defense: Fianchetto Variation|d4 f5 c4 Nf6 g3
A87|Dutch Defense: Leningrad Variation|^A86 g6 Bg2 Bg7 Nf3
A88|Dutch Defense: Leningrad, Warsaw Variation|^A87 O-O O-O d6 Nc3 c6
A89|Dutch Defense: Leningrad, Matulović Variation|^A87 O-O O-O d6 Nc3 Nc6
A90|Dutch Defense: Classical Variation|^A86 e6 Bg2
A91|Dutch Defense: Classical, 4...Be7|^A90 Be7
A92|Dutch Defense: Classical, 5...O-O|^A91 Nf3 O-O
A93|Dutch Defense: Stonewall, Botvinnik Variation|^A92 O-O d5 b3
A94|Dutch Defense: Stonewall with Ba3|^A93 c6 Ba3
A95|Dutch Defense: Stonewall with Nc3|^A92 O-O d5 Nc3 c6
A96|Dutch Defense: Classical, Ilyin-Zhenevsky Setup|^A92 O-O d6
A97|Dutch Defense: Ilyin-Zhenevsky Variation|^A96 Nc3 Qe8
A98|Dutch Defense: Ilyin-Zhenevsky with Qc2|^A97 Qc2
A99|Dutch Defense: Ilyin-Zhenevsky with b3|^A97 b3
B00|King's Pawn Opening|e4
B01|Scandinavian Defense|e4 d5
B02|Alekhine's Defense|e4 Nf6
B03|Alekhine's Defense: 3.d4|e4 Nf6 e5 Nd5 d4
B04|Alekhine's Defense: Modern Variation|^B03 d6 Nf3
B05|Alekhine's Defense: Modern, Main Line|^B04 Bg4
B06|Modern Defense|e4 g6
B07|Pirc Defense: 3.Nc3|e4 d6 d4 Nf6 Nc3
B08|Pirc Defense: Classical Variation|^B07 g6 Nf3
B09|Pirc Defense: Austrian Attack|^B07 g6 f4
B10|Caro-Kann Defense|e4 c6
B11|Caro-Kann Defense: Two Knights Attack, Mindeno Variation|e4 c6 Nc3 d5 Nf3 Bg4
B12|Caro-Kann Defense: Main Line|e4 c6 d4 d5
B13|Caro-Kann Defense: Exchange Variation|^B12 exd5 cxd5
B14|Caro-Kann Defense: Panov-Botvinnik Attack|^B13 c4 Nf6 Nc3 e6
B15|Caro-Kann Defense: 3.Nc3|^B12 Nc3
B16|Caro-Kann Defense: Bronstein-Larsen Variation|^B15 dxe4 Nxe4 Nf6 Nxf6+ gxf6
B17|Caro-Kann Defense: Karpov Variation|^B15 dxe4 Nxe4 Nd7
B18|Caro-Kann Defense: Classical Variation|^B15 dxe4 Nxe4 Bf5
B19|Caro-Kann Defense: Classical, Main Line|^B18 Ng3 Bg6 h4 h6 Nf3 Nd7
B20|Sicilian Defense|e4 c5
B21|Sicilian Defense: McDonnell Attack|e4 c5 f4
B22|Sicilian Defense: Alapin Variation|e4 c5 c3
B23|Sicilian Defense: Closed|e4 c5 Nc3
B24|Sicilian Defense: Closed, Fianchetto|e4 c5 Nc3 Nc6 g3
B25|Sicilian Defense: Closed, Traditional Line|e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6
B26|Sicilian Defense: Closed, 6.Be3|^B25 Be3
B27|Sicilian Defense: 2.Nf3|e4 c5 Nf3
B28|Sicilian Defense: O'Kelly Variation|^B27 a6
B29|Sicilian Defense: Nimzowitsch-Rubinstein Variation|^B27 Nf6
B30|Sicilian Defense: Old Sicilian|^B27 Nc6
B31|Sicilian Defense: Rossolimo, Fianchetto Variation|^B30 Bb5 g6
B32|Sicilian Defense: Open, 2...Nc6|^B30 d4 cxd4 Nxd4
B33|Sicilian Defense: Sveshnikov Variation|^B32 Nf6 Nc3 e5
B34|Sicilian Defense: Accelerated Dragon, Exchange Variation|^B32 g6 Nxc6
B35|Sicilian Defense: Accelerated Dragon, Modern Bc4 Variation|^B32 g6 Nc3 Bg7 Be3 Nf6 Bc4
B36|Sicilian Defense: Accelerated Dragon, Maróczy Bind|^B32 g6 c4
B37|Sicilian Defense: Maróczy Bind, 5...Bg7|^B36 Bg7
B38|Sicilian Defense: Maróczy Bind, 6.Be3|^B37 Be3
B39|Sicilian Defense: Maróczy Bind, Breyer Variation|^B38 Nf6 Nc3 Ng4
B40|Sicilian Defense: French Variation|^B27 e6
B41|Sicilian Defense: Kan Variation|^B40 d4 cxd4 Nxd4 a6
B42|Sicilian Defense: Kan, 5.Bd3|^B41 Bd3
B43|Sicilian Defense: Kan, 5.Nc3|^B41 Nc3
B44|Sicilian Defense: Taimanov Variation|^B40 d4 cxd4 Nxd4 Nc6
B45|Sicilian Defense: Taimanov, 5.Nc3|^B44 Nc3
B46|Sicilian Defense: Taimanov, 5...a6|^B45 a6
B47|Sicilian Defense: Taimanov, Bastrikov Variation|^B45 Qc7
B48|Sicilian Defense: Taimanov, English Attack Setup|^B47 Be3
B49|Sicilian Defense: Taimanov, 7.Be2|^B48 a6 Be2
B50|Sicilian Defense: Modern Variations|^B27 d6
B51|Sicilian Defense: Moscow Variation|^B50 Bb5+
B52|Sicilian Defense: Moscow, 3...Bd7|^B51 Bd7
B53|Sicilian Defense: Chekhover Variation|^B50 d4 cxd4 Qxd4
B54|Sicilian Defense: Open|^B50 d4 cxd4 Nxd4
B55|Sicilian Defense: Prins Variation, Venice Attack|^B54 Nf6 f3 e5 Bb5+
B56|Sicilian Defense: Classical Setup|^B54 Nf6 Nc3
B57|Sicilian Defense: Sozin Attack, 5...Nc6|^B56 Nc6 Bc4
B58|Sicilian Defense: Classical, 6.Be2|^B56 Nc6 Be2
B59|Sicilian Defense: Boleslavsky Variation, 7.Nb3|^B58 e5 Nb3
B60|Sicilian Defense: Richter-Rauzer Attack|^B56 Nc6 Bg5
B61|Sicilian Defense: Richter-Rauzer, Larsen Variation|^B60 Bd7 Qd2
B62|Sicilian Defense: Richter-Rauzer, 6...e6|^B60 e6
B63|Sicilian Defense: Richter-Rauzer, Rauzer Attack|^B62 Qd2
B64|Sicilian Defense: Richter-Rauzer, 9.f4|^B63 Be7 O-O-O O-O f4
B65|Sicilian Defense: Richter-Rauzer, 9...Nxd4|^B64 Nxd4 Qxd4
B66|Sicilian Defense: Richter-Rauzer, 7...a6|^B63 a6
B67|Sicilian Defense: Richter-Rauzer, 8...Bd7|^B66 O-O-O Bd7
B68|Sicilian Defense: Richter-Rauzer, 9...Be7|^B67 f4 Be7
B69|Sicilian Defense: Richter-Rauzer, 11.Bxf6|^B68 Nf3 b5 Bxf6
B70|Sicilian Defense: Dragon Variation|^B56 g6
B71|Sicilian Defense: Dragon, Levenfish Variation|^B70 f4
B72|Sicilian Defense: Dragon, 6.Be3|^B70 Be3
B73|Sicilian Defense: Dragon, Classical, 8.O-O|^B72 Bg7 Be2 Nc6 O-O
B74|Sicilian Defense: Dragon, Classical, 9.Nb3|^B73 O-O Nb3
B75|Sicilian Defense: Dragon, Yugoslav Attack|^B72 Bg7 f3
B76|Sicilian Defense: Dragon, Yugoslav Attack, 7...O-O|^B75 O-O
B77|Sicilian Defense: Dragon, Yugoslav Attack, 9.Bc4|^B76 Qd2 Nc6 Bc4
B78|Sicilian Defense: Dragon, Yugoslav Attack, 10.O-O-O|^B77 Bd7 O-O-O
B79|Sicilian Defense: Dragon, Yugoslav Attack, 12.h4|^B78 Qa5 Bb3 Rfc8 h4
B80|Sicilian Defense: Scheveningen Variation|^B56 e6
B81|Sicilian Defense: Scheveningen, Keres Attack|^B80 g4
B82|Sicilian Defense: Scheveningen, 6.f4|^B80 f4
B83|Sicilian Defense: Scheveningen, 6.Be2|^B80 Be2
B84|Sicilian Defense: Scheveningen, Classical|^B83 a6
B85|Sicilian Defense: Scheveningen, Classical Main Line|^B84 O-O Qc7 f4 Nc6
B86|Sicilian Defense: Sozin Attack|^B80 Bc4
B87|Sicilian Defense: Sozin with ...a6 and ...b5|^B86 a6 Bb3 b5
B88|Sicilian Defense: Sozin, Leonhardt Variation|^B86 Nc6
B89|Sicilian Defense: Sozin, 7.Be3|^B88 Be3
B90|Sicilian Defense: Najdorf Variation|^B56 a6
B91|Sicilian Defense: Najdorf, Zagreb Variation|^B90 g3
B92|Sicilian Defense: Najdorf, Opočenský Variation|^B90 Be2
B93|Sicilian Defense: Najdorf, 6.f4|^B90 f4
B94|Sicilian Defense: Najdorf, 6.Bg5|^B90 Bg5
B95|Sicilian Defense: Najdorf, 6...e6|^B94 e6
B96|Sicilian Defense: Najdorf, 7.f4|^B95 f4
B97|Sicilian Defense: Najdorf, Poisoned Pawn Variation|^B96 Qb6
B98|Sicilian Defense: Najdorf, 7...Be7|^B96 Be7
B99|Sicilian Defense: Najdorf, Main Line|^B98 Qf3 Qc7 O-O-O Nbd7
C00|French Defense|e4 e6
C01|French Defense: Exchange Variation|e4 e6 d4 d5 exd5 exd5
C02|French Defense: Advance Variation|e4 e6 d4 d5 e5
C03|French Defense: Tarrasch Variation|e4 e6 d4 d5 Nd2
C04|French Defense: Tarrasch, Guimard Main Line|^C03 Nc6 Ngf3 Nf6
C05|French Defense: Tarrasch, Closed Variation|^C03 Nf6
C06|French Defense: Tarrasch, Closed Main Line|^C05 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2
C07|French Defense: Tarrasch, Open Variation|^C03 c5
C08|French Defense: Tarrasch, Open, 4.exd5 exd5|^C07 exd5 exd5
C09|French Defense: Tarrasch, Open Main Line|^C08 Ngf3 Nc6
C10|French Defense: Paulsen Variation|e4 e6 d4 d5 Nc3
C11|French Defense: Classical Variation|^C10 Nf6
C12|French Defense: MacCutcheon Variation|^C11 Bg5 Bb4
C13|French Defense: Classical, 4...Be7|^C11 Bg5 Be7
C14|French Defense: Classical, Main Line|^C13 e5 Nfd7 Bxe7 Qxe7
C15|French Defense: Winawer Variation|^C10 Bb4
C16|French Defense: Winawer, Advance Variation|^C15 e5
C17|French Defense: Winawer, Advance, 4...c5|^C16 c5
C18|French Defense: Winawer, Main Line|^C17 a3 Bxc3+ bxc3
C19|French Defense: Winawer, 6...Ne7|^C18 Ne7
C20|King's Pawn Game|e4 e5
C21|Center Game Accepted|e4 e5 d4 exd4
C22|Center Game: Normal Variation|e4 e5 d4 exd4 Qxd4 Nc6
C23|Bishop's Opening|e4 e5 Bc4
C24|Bishop's Opening: Berlin Defense|e4 e5 Bc4 Nf6
C25|Vienna Game|e4 e5 Nc3
C26|Vienna Game: Falkbeer Variation|e4 e5 Nc3 Nf6
C27|Vienna Game: Frankenstein-Dracula Variation|e4 e5 Nc3 Nf6 Bc4 Nxe4
C28|Vienna Game: Stanley Variation, Three Knights|e4 e5 Nc3 Nf6 Bc4 Nc6
C29|Vienna Gambit|e4 e5 Nc3 Nf6 f4
C30|King's Gambit|e4 e5 f4
C31|King's Gambit Declined: Falkbeer Countergambit|e4 e5 f4 d5
C32|King's Gambit Declined: Falkbeer, Charousek Gambit|e4 e5 f4 d5 exd5 e4 d3 Nf6 dxe4
C33|King's Gambit Accepted|e4 e5 f4 exf4
C34|King's Gambit Accepted: King's Knight's Gambit|^C33 Nf3
C35|King's Gambit Accepted: Cunningham Defense|^C34 Be7
C36|King's Gambit Accepted: Abbazia Defense|^C34 d5
C37|King's Gambit Accepted: Muzio Gambit|^C34 g5 Bc4 g4 O-O
C38|King's Gambit Accepted: Traditional Variation|^C34 g5 Bc4 Bg7
C39|King's Gambit Accepted: Paris Attack|^C34 g5 h4
C40|King's Knight Opening|e4 e5 Nf3
C41|Philidor Defense|e4 e5 Nf3 d6
C42|Petrov's Defense|e4 e5 Nf3 Nf6
C43|Petrov's Defense: Steinitz Attack|e4 e5 Nf3 Nf6 d4
C44|King's Knight Opening: Normal Variation|e4 e5 Nf3 Nc6
C45|Scotch Game: Main Line|e4 e5 Nf3 Nc6 d4 exd4 Nxd4
C46|Three Knights Opening|e4 e5 Nf3 Nc6 Nc3
C47|Four Knights Game|^C46 Nf6
C48|Four Knights Game: Spanish Variation|^C47 Bb5
C49|Four Knights Game: Double Spanish|^C48 Bb4
C50|Italian Game|e4 e5 Nf3 Nc6 Bc4
C51|Italian Game: Evans Gambit|^C50 Bc5 b4
C52|Italian Game: Evans Gambit, Main Line|^C51 Bxb4 c3 Ba5
C53|Italian Game: Classical Variation|^C50 Bc5 c3
C54|Italian Game: Classical, Center Attack|^C53 Nf6 d4 exd4 cxd4
C55|Italian Game: Two Knights Defense|^C50 Nf6
C56|Italian Game: Scotch Gambit, Max Lange Defense|^C55 d4 exd4 O-O Nxe4
C57|Italian Game: Two Knights, Knight Attack|^C55 Ng5
C58|Italian Game: Two Knights, Polerio Defense|^C57 d5 exd5 Na5
C59|Italian Game: Two Knights, Polerio Main Line|^C58 Bb5+ c6 dxc6 bxc6 Be2 h6
C60|Ruy López|e4 e5 Nf3 Nc6 Bb5
C61|Ruy López: Bird's Defense|^C60 Nd4
C62|Ruy López: Steinitz Defense|^C60 d6
C63|Ruy López: Schliemann Defense|^C60 f5
C64|Ruy López: Classical Defense|^C60 Bc5
C65|Ruy López: Berlin Defense|^C60 Nf6
C66|Ruy López: Berlin Defense, Improved Steinitz|^C65 O-O d6
C67|Ruy López: Berlin Defense, Rio Gambit Accepted|^C65 O-O Nxe4
C68|Ruy López: Exchange Variation|^C60 a6 Bxc6
C69|Ruy López: Exchange, Gligorić Variation|^C68 dxc6 O-O f6
C70|Ruy López: Morphy Defense, 4.Ba4|^C60 a6 Ba4
C71|Ruy López: Modern Steinitz Defense|^C70 d6
C72|Ruy López: Modern Steinitz, 5.O-O|^C71 O-O
C73|Ruy López: Modern Steinitz, Richter Variation|^C71 Bxc6+ bxc6 d4
C74|Ruy López: Modern Steinitz, 5.c3|^C71 c3
C75|Ruy López: Modern Steinitz, 5...Bd7|^C74 Bd7
C76|Ruy López: Modern Steinitz, Fianchetto Variation|^C75 d4 g6
C77|Ruy López: Morphy Defense, 4...Nf6|^C70 Nf6
C78|Ruy López: Morphy Defense, 5.O-O|^C77 O-O
C79|Ruy López: Steinitz Defense Deferred|^C78 d6
C80|Ruy López: Open Variation|^C78 Nxe4
C81|Ruy López: Open, Howell Attack|^C80 d4 b5 Bb3 d5 dxe5 Be6 Qe2
C82|Ruy López: Open, 9.c3|^C80 d4 b5 Bb3 d5 dxe5 Be6 c3
C83|Ruy López: Open, Classical Defense|^C82 Be7
C84|Ruy López: Closed|^C78 Be7
C85|Ruy López: Closed, Delayed Exchange|^C84 Bxc6
C86|Ruy López: Closed, Worrall Attack|^C84 Qe2
C87|Ruy López: Closed, Averbakh Variation|^C84 Re1 d6
C88|Ruy López: Closed, 7.Bb3|^C84 Re1 b5 Bb3
C89|Ruy López: Marshall Attack|^C88 O-O c3 d5
C90|Ruy López: Closed, 8.c3 O-O|^C88 d6 c3 O-O
C91|Ruy López: Closed, 9.d4|^C90 d4
C92|Ruy López: Closed, 9.h3|^C90 h3
C93|Ruy López: Closed, Smyslov Defense|^C92 h6
C94|Ruy López: Closed, Breyer Defense|^C92 Nb8
C95|Ruy López: Closed, Breyer, 10.d4|^C94 d4
C96|Ruy López: Closed, Chigorin Defense|^C92 Na5 Bc2
C97|Ruy López: Closed, Chigorin, 11...Qc7|^C96 c5 d4 Qc7
C98|Ruy López: Closed, Chigorin, 12...Nc6|^C97 Nbd2 Nc6
C99|Ruy López: Closed, Chigorin, 12...cxd4|^C97 Nbd2 cxd4 cxd4
D00|Queen's Pawn Game: Closed|d4 d5
D01|Richter-Veresov Attack|d4 d5 Nc3 Nf6 Bg5
D02|Queen's Pawn Game: Zukertort Variation|d4 d5 Nf3
D03|Queen's Pawn Game: Torre Attack|d4 d5 Nf3 Nf6 Bg5
D04|Queen's Pawn Game: Colle System|d4 d5 Nf3 Nf6 e3
D05|Queen's Pawn Game: Colle System, 3...e6|^D04 e6
D06|Queen's Gambit|d4 d5 c4
D07|Queen's Gambit Declined: Chigorin Defense|^D06 Nc6
D08|Queen's Gambit Declined: Albin Countergambit|^D06 e5
D09|Queen's Gambit Declined: Albin Countergambit, Fianchetto Variation|^D08 dxe5 d4 Nf3 Nc6 g3
D10|Slav Defense|^D06 c6
D11|Slav Defense: Modern Line|^D10 Nf3
D12|Slav Defense: Quiet Variation, Schallopp Defense|^D11 Nf6 e3 Bf5
D13|Slav Defense: Exchange Variation|^D11 Nf6 cxd5 cxd5
D14|Slav Defense: Exchange, Symmetrical Line|^D13 Nc3 Nc6 Bf4 Bf5
D15|Slav Defense: Three Knights Variation|^D11 Nf6 Nc3
D16|Slav Defense: Alapin Variation|^D15 dxc4 a4
D17|Slav Defense: Czech Variation|^D16 Bf5
D18|Slav Defense: Dutch Variation|^D17 e3
D19|Slav Defense: Dutch Variation, Main Line|^D18 e6 Bxc4 Bb4 O-O O-O Qe2
D20|Queen's Gambit Accepted|^D06 dxc4
D21|Queen's Gambit Accepted: Normal Variation|^D20 Nf3
D22|Queen's Gambit Accepted: Alekhine Defense|^D21 a6
D23|Queen's Gambit Accepted: 3...Nf6|^D21 Nf6
D24|Queen's Gambit Accepted: Showalter Variation|^D23 Nc3
D25|Queen's Gambit Accepted: 4.e3|^D23 e3
D26|Queen's Gambit Accepted: Classical Defense|^D25 e6
D27|Queen's Gambit Accepted: Classical, Main Line|^D26 Bxc4 c5 O-O a6
D28|Queen's Gambit Accepted: Classical, 7.Qe2|^D27 Qe2
D29|Queen's Gambit Accepted: Classical, 8...Bb7|^D28 b5 Bb3 Bb7
D30|Queen's Gambit Declined|^D06 e6
D31|Queen's Gambit Declined: 3.Nc3|^D30 Nc3
D32|Queen's Gambit Declined: Tarrasch Defense|^D31 c5
D33|Queen's Gambit Declined: Tarrasch, Schlechter-Rubinstein System|^D32 cxd5 exd5 Nf3 Nc6 g3
D34|Queen's Gambit Declined: Tarrasch, Main Line|^D33 Nf6 Bg2 Be7
D35|Queen's Gambit Declined: Normal Defense|^D31 Nf6
D36|Queen's Gambit Declined: Exchange, Positional Line|^D35 cxd5 exd5 Bg5 c6 Qc2
D37|Queen's Gambit Declined: Three Knights Variation|^D35 Nf3
D38|Queen's Gambit Declined: Ragozin Defense|^D37 Bb4
D39|Queen's Gambit Declined: Ragozin, Vienna Variation|^D38 Bg5 dxc4
D40|Queen's Gambit Declined: Semi-Tarrasch Defense|^D37 c5
D41|Queen's Gambit Declined: Semi-Tarrasch, 5.cxd5|^D40 cxd5
D42|Queen's Gambit Declined: Semi-Tarrasch, 7.Bd3|^D41 Nxd5 e3 Nc6 Bd3
D43|Semi-Slav Defense|^D37 c6
D44|Semi-Slav Defense: Botvinnik System Setup|^D43 Bg5 dxc4
D45|Semi-Slav Defense: 5.e3|^D43 e3
D46|Semi-Slav Defense: 6.Bd3|^D45 Nbd7 Bd3
D47|Semi-Slav Defense: Meran Variation|^D46 dxc4 Bxc4
D48|Semi-Slav Defense: Meran, 8...a6|^D47 b5 Bd3 a6
D49|Semi-Slav Defense: Meran, Blumenfeld Variation|^D48 e4 c5 e5 cxd4 Nxb5
D50|Queen's Gambit Declined: 4.Bg5|^D35 Bg5
D51|Queen's Gambit Declined: 4...Nbd7|^D50 Nbd7
D52|Queen's Gambit Declined: Cambridge Springs Setup|^D51 e3 c6 Nf3
D53|Queen's Gambit Declined: 4...Be7|^D50 Be7
D54|Queen's Gambit Declined: Anti-Neo-Orthodox Variation|^D53 e3 O-O Rc1
D55|Queen's Gambit Declined: 6.Nf3|^D53 e3 O-O Nf3
D56|Queen's Gambit Declined: Lasker Defense|^D55 h6 Bh4 Ne4
D57|Queen's Gambit Declined: Lasker Defense, Main Line|^D56 Bxe7 Qxe7 cxd5 Nxc3 bxc3
D58|Queen's Gambit Declined: Tartakower Defense|^D55 h6 Bh4 b6
D59|Queen's Gambit Declined: Tartakower, 8.cxd5 Nxd5|^D58 cxd5 Nxd5
D60|Queen's Gambit Declined: Orthodox Defense|^D55 Nbd7
D61|Queen's Gambit Declined: Orthodox, Rubinstein Variation|^D60 Qc2
D62|Queen's Gambit Declined: Orthodox, Rubinstein, 8.cxd5|^D61 c5 cxd5
D63|Queen's Gambit Declined: Orthodox, 7.Rc1|^D60 Rc1
D64|Queen's Gambit Declined: Orthodox, Rubinstein Attack|^D63 c6 Qc2
D65|Queen's Gambit Declined: Orthodox, Rubinstein Attack Main Line|^D64 a6 cxd5
D66|Queen's Gambit Declined: Orthodox, Bd3 Line|^D63 c6 Bd3
D67|Queen's Gambit Declined: Orthodox, Capablanca Freeing Manoeuvre|^D66 dxc4 Bxc4 Nd5
D68|Queen's Gambit Declined: Orthodox, Classical Variation|^D67 Bxe7 Qxe7 O-O Nxc3 Rxc3 e5
D69|Queen's Gambit Declined: Orthodox, Classical, 13.dxe5|^D68 dxe5 Nxe5 Nxe5 Qxe5
D70|Neo-Grünfeld Defense: Goglidze Attack|d4 Nf6 c4 g6 f3 d5
D71|Neo-Grünfeld Defense: 3.g3 d5|d4 Nf6 c4 g6 g3 d5
D72|Neo-Grünfeld Defense: Exchange, Main Line|^D71 Bg2 Bg7 cxd5 Nxd5 e4 Nb6 Ne2
D73|Neo-Grünfeld Defense: 5.Nf3|^D71 Bg2 Bg7 Nf3
D74|Neo-Grünfeld Defense: Delayed Exchange|^D73 O-O cxd5 Nxd5 O-O
D75|Neo-Grünfeld Defense: Delayed Exchange, 8.dxc5|^D74 c5 dxc5
D76|Neo-Grünfeld Defense: Delayed Exchange, 7...Nb6|^D74 Nb6
D77|Neo-Grünfeld Defense: Classical Variation|^D73 O-O O-O
D78|Neo-Grünfeld Defense: Classical, 6...c6|^D77 c6
D79|Neo-Grünfeld Defense: Classical, Main Line|^D78 cxd5 cxd5
D80|Grünfeld Defense|d4 Nf6 c4 g6 Nc3 d5
D81|Grünfeld Defense: Russian, Accelerated Variation|^D80 Qb3
D82|Grünfeld Defense: Brinckmann Attack|^D80 Bf4
D83|Grünfeld Defense: Grünfeld Gambit|^D82 Bg7 e3 O-O
D84|Grünfeld Defense: Grünfeld Gambit Accepted|^D83 cxd5 Nxd5 Nxd5 Qxd5 Bxc7
D85|Grünfeld Defense: Exchange Variation|^D80 cxd5 Nxd5
D86|Grünfeld Defense: Exchange, Classical Variation|^D85 e4 Nxc3 bxc3 Bg7 Bc4
D87|Grünfeld Defense: Exchange, Spassky Variation|^D86 O-O Ne2 c5
D88|Grünfeld Defense: Exchange, Spassky, 11.cxd4|^D87 O-O Nc6 Be3 cxd4 cxd4
D89|Grünfeld Defense: Exchange, Spassky, 13.Bd3|^D88 Bg4 f3 Na5 Bd3 Be6
D90|Grünfeld Defense: Three Knights Variation|^D80 Nf3
D91|Grünfeld Defense: Three Knights, Petrosian System|^D90 Bg7 Bg5
D92|Grünfeld Defense: Three Knights, Hungarian Attack|^D90 Bg7 Bf4
D93|Grünfeld Defense: Three Knights, Burille Variation|^D92 O-O e3
D94|Grünfeld Defense: Three Knights, 5.e3|^D90 Bg7 e3
D95|Grünfeld Defense: Three Knights, Botvinnik Variation|^D94 O-O Qb3
D96|Grünfeld Defense: Russian Variation|^D90 Bg7 Qb3
D97|Grünfeld Defense: Russian, 7.e4|^D96 dxc4 Qxc4 O-O e4
D98|Grünfeld Defense: Russian, Smyslov Variation|^D97 Bg4
D99|Grünfeld Defense: Russian, Smyslov Main Line|^D98 Be3 Nfd7 Qb3
E00|Indian Defense: East Indian / Catalan Setup|d4 Nf6 c4 e6
E01|Catalan Opening: Closed|^E00 g3 d5 Bg2
E02|Catalan Opening: Open, 5.Qa4+|^E01 dxc4 Qa4+
E03|Catalan Opening: Open, Alekhine Variation|^E02 Nbd7 Qxc4
E04|Catalan Opening: Open, 5.Nf3|^E01 dxc4 Nf3
E05|Catalan Opening: Open, Classical Line|^E04 Be7
E06|Catalan Opening: Closed, 5.Nf3|^E01 Be7 Nf3
E07|Catalan Opening: Closed, 6...Nbd7|^E06 O-O O-O Nbd7
E08|Catalan Opening: Closed, 7.Qc2|^E07 Qc2
E09|Catalan Opening: Closed, Main Line|^E08 c6 Nbd2
E10|Indian Defense: Anti-Nimzo-Indian|^E00 Nf3
E11|Bogo-Indian Defense|^E10 Bb4+
E12|Queen's Indian Defense|^E10 b6
E13|Queen's Indian Defense: Kasparov Variation, Main Line|^E12 Nc3 Bb7 Bg5 h6 Bh4 Bb4
E14|Queen's Indian Defense: Spassky System|^E12 e3
E15|Queen's Indian Defense: Fianchetto Variation|^E12 g3
E16|Queen's Indian Defense: Capablanca Variation|^E15 Bb7 Bg2 Bb4+
E17|Queen's Indian Defense: Classical Variation|^E15 Bb7 Bg2 Be7
E18|Queen's Indian Defense: Classical, Traditional Line|^E17 O-O O-O Nc3
E19|Queen's Indian Defense: Classical, Main Line|^E18 Ne4 Qc2 Nxc3 Qxc3
E20|Nimzo-Indian Defense|^E00 Nc3 Bb4
E21|Nimzo-Indian Defense: Three Knights Variation|^E20 Nf3
E22|Nimzo-Indian Defense: Spielmann Variation|^E20 Qb3
E23|Nimzo-Indian Defense: Spielmann, 5...Nc6|^E22 c5 dxc5 Nc6
E24|Nimzo-Indian Defense: Sämisch Variation|^E20 a3 Bxc3+ bxc3
E25|Nimzo-Indian Defense: Sämisch, Keres Variation|^E24 c5 f3 d5 cxd5
E26|Nimzo-Indian Defense: Sämisch, 6.e3|^E24 c5 e3
E27|Nimzo-Indian Defense: Sämisch, 5...O-O|^E24 O-O
E28|Nimzo-Indian Defense: Sämisch, 6.e3 after castling|^E27 e3
E29|Nimzo-Indian Defense: Sämisch, Main Line|^E28 c5 Bd3 Nc6
E30|Nimzo-Indian Defense: Leningrad Variation|^E20 Bg5
E31|Nimzo-Indian Defense: Leningrad, Main Line|^E30 h6 Bh4 c5 d5 d6
E32|Nimzo-Indian Defense: Classical Variation|^E20 Qc2
E33|Nimzo-Indian Defense: Classical, Zurich Variation|^E32 Nc6
E34|Nimzo-Indian Defense: Classical, Noa Variation|^E32 d5
E35|Nimzo-Indian Defense: Classical, Noa, Exchange|^E34 cxd5 exd5
E36|Nimzo-Indian Defense: Classical, Noa, 5.a3|^E34 a3
E37|Nimzo-Indian Defense: Classical, Noa Main Line|^E36 Bxc3+ Qxc3 Ne4
E38|Nimzo-Indian Defense: Classical, Berlin Variation|^E32 c5
E39|Nimzo-Indian Defense: Classical, Pirc Variation|^E38 dxc5 O-O
E40|Nimzo-Indian Defense: Rubinstein System|^E20 e3
E41|Nimzo-Indian Defense: Hübner Setup|^E40 c5
E42|Nimzo-Indian Defense: Rubinstein, 5.Ne2|^E41 Ne2
E43|Nimzo-Indian Defense: Fischer Variation|^E40 b6
E44|Nimzo-Indian Defense: Fischer, 5.Ne2|^E43 Ne2
E45|Nimzo-Indian Defense: Fischer, Bronstein Variation|^E44 Ba6
E46|Nimzo-Indian Defense: Rubinstein, 4...O-O|^E40 O-O
E47|Nimzo-Indian Defense: Rubinstein, 5.Bd3|^E46 Bd3
E48|Nimzo-Indian Defense: Rubinstein, 5...d5|^E47 d5
E49|Nimzo-Indian Defense: Botvinnik System|^E48 a3 Bxc3+ bxc3
E50|Nimzo-Indian Defense: Rubinstein, 5.Nf3|^E46 Nf3
E51|Nimzo-Indian Defense: Ragozin Setup|^E50 d5
E52|Nimzo-Indian Defense: Main Line with ...b6|^E51 Bd3 b6
E53|Nimzo-Indian Defense: Main Line with ...c5|^E51 Bd3 c5
E54|Nimzo-Indian Defense: Gligorić System|^E53 O-O dxc4 Bxc4
E55|Nimzo-Indian Defense: Gligorić, Bronstein Variation|^E54 Nbd7
E56|Nimzo-Indian Defense: Main Line with 7...Nc6|^E53 O-O Nc6
E57|Nimzo-Indian Defense: Main Line, 9...cxd4|^E56 a3 dxc4 Bxc4 cxd4
E58|Nimzo-Indian Defense: Main Line, 8...Bxc3|^E56 a3 Bxc3 bxc3
E59|Nimzo-Indian Defense: Main Line, 10.Bxc4|^E58 dxc4 Bxc4
E60|King's Indian Defense|d4 Nf6 c4 g6
E61|King's Indian Defense: 3.Nc3|^E60 Nc3
E62|King's Indian Defense: Fianchetto Variation|^E61 Bg7 Nf3 d6 g3
E63|King's Indian Defense: Fianchetto, Panno Variation|^E62 O-O Bg2 Nc6 O-O a6
E64|King's Indian Defense: Fianchetto, Yugoslav System|^E62 O-O Bg2 c5
E65|King's Indian Defense: Fianchetto, Yugoslav, 7.O-O|^E64 O-O
E66|King's Indian Defense: Fianchetto, Yugoslav Panno|^E65 Nc6 d5
E67|King's Indian Defense: Fianchetto, Classical Variation|^E62 O-O Bg2 Nbd7
E68|King's Indian Defense: Fianchetto, Classical, 8.e4|^E67 O-O e5 e4
E69|King's Indian Defense: Fianchetto, Classical Main Line|^E68 c6 h3
E70|King's Indian Defense: 4.e4|^E61 Bg7 e4
E71|King's Indian Defense: Makogonov Variation|^E70 d6 h3
E72|King's Indian Defense: Pomar System|^E70 d6 g3
E73|King's Indian Defense: Semi-Averbakh System|^E70 d6 Be2
E74|King's Indian Defense: Averbakh Variation|^E73 O-O Bg5 c5
E75|King's Indian Defense: Averbakh, Main Line|^E74 d5 e6
E76|King's Indian Defense: Four Pawns Attack|^E70 d6 f4
E77|King's Indian Defense: Four Pawns Attack, 6.Be2|^E76 O-O Be2
E78|King's Indian Defense: Four Pawns Attack, 7.Nf3|^E77 c5 Nf3
E79|King's Indian Defense: Four Pawns Attack, Main Line|^E78 cxd4 Nxd4 Nc6 Be3
E80|King's Indian Defense: Sämisch Variation|^E70 d6 f3
E81|King's Indian Defense: Sämisch, 5...O-O|^E80 O-O
E82|King's Indian Defense: Sämisch, Double Fianchetto|^E81 Be3 b6
E83|King's Indian Defense: Sämisch, 6...Nc6|^E81 Be3 Nc6
E84|King's Indian Defense: Sämisch, Panno Main Line|^E83 Nge2 a6 Qd2 Rb8
E85|King's Indian Defense: Sämisch, Orthodox Variation|^E81 Be3 e5
E86|King's Indian Defense: Sämisch, Orthodox, 7.Nge2 c6|^E85 Nge2 c6
E87|King's Indian Defense: Sämisch, Orthodox, 7.d5|^E85 d5
E88|King's Indian Defense: Sämisch, Orthodox, 7.d5 c6|^E87 c6
E89|King's Indian Defense: Sämisch, Orthodox Main Line|^E88 Nge2 cxd5
E90|King's Indian Defense: Normal Variation|^E70 d6 Nf3
E91|King's Indian Defense: Classical, 6.Be2|^E90 O-O Be2
E92|King's Indian Defense: Classical Variation|^E91 e5
E93|King's Indian Defense: Petrosian System|^E92 d5 Nbd7
E94|King's Indian Defense: Orthodox Variation|^E92 O-O
E95|King's Indian Defense: Orthodox, 7...Nbd7 8.Re1|^E94 Nbd7 Re1
E96|King's Indian Defense: Orthodox, 7...Nbd7 Main Line|^E95 c6 Bf1 a5
E97|King's Indian Defense: Orthodox, Aronin-Taimanov Defense|^E94 Nc6
E98|King's Indian Defense: Orthodox, Taimanov, 9.Ne1|^E97 d5 Ne7 Ne1
E99|King's Indian Defense: Mar del Plata Variation|^E98 Nd7 f3 f5
A00|Grob Opening|g4
A00|Anderssen's Opening|a3
A00|Van't Kruijs Opening|e3
A00|Mieses Opening|d3
A00|Saragossa Opening|c3
A00|Van Geet Opening|Nc3
A00|Hungarian Opening|g3
A00|Clemenz Opening|h3
A00|Ware Opening|a4
A00|Kádas Opening|h4
A00|Barnes Opening|f3
A00|Amar Opening|Nh3
A00|Sodium Attack|Na3
A01|Nimzowitsch-Larsen Attack: Modern Variation|b3 e5
A01|Nimzowitsch-Larsen Attack: Classical Variation|b3 d5
A02|Bird's Opening: From's Gambit|f4 e5
A04|Réti Opening: Sicilian Invitation|Nf3 c5
A05|King's Indian Attack: Symmetrical Defense|Nf3 Nf6 g3
A06|Réti Opening: Nimzowitsch-Larsen Variation|Nf3 d5 b3
A09|Réti Opening: Advance Variation|Nf3 d5 c4 d4
A09|Réti Opening: Réti Gambit Accepted|Nf3 d5 c4 dxc4
A10|English Opening: Anglo-Dutch Defense|c4 f5
A40|Englund Gambit|d4 e5
A40|Modern Defense: 1.d4 g6|d4 g6
A40|English Defense|d4 e6 c4 b6
A40|Horwitz Defense|d4 e6
A45|Trompowsky Attack|d4 Nf6 Bg5
A45|Indian Defense: London System|d4 Nf6 Bf4
A46|Torre Attack: Classical Defense|d4 Nf6 Nf3 e6 Bg5
A46|London System: Indian Setup|d4 Nf6 Nf3 e6 Bf4
A48|London System: King's Indian Setup|d4 Nf6 Nf3 g6 Bf4
A56|Benoni Defense: Czech Benoni|d4 Nf6 c4 c5 d5 e5
A80|Dutch Defense: Hopton Attack|d4 f5 Bg5
B00|Nimzowitsch Defense|e4 Nc6
B00|Owen's Defense|e4 b6
B00|St. George Defense|e4 a6
B00|Borg Defense|e4 g5
B01|Scandinavian Defense: Mieses-Kotroč Variation|e4 d5 exd5 Qxd5
B01|Scandinavian Defense: Main Line, 3...Qa5|e4 d5 exd5 Qxd5 Nc3 Qa5
B01|Scandinavian Defense: Modern Variation|e4 d5 exd5 Nf6
B02|Alekhine's Defense: Normal Variation|e4 Nf6 e5 Nd5
B06|Modern Defense: Standard Line|e4 g6 d4 Bg7
B07|Pirc Defense|e4 d6
B07|Pirc Defense: Main Setup|e4 d6 d4 Nf6
B07|Czech Defense|e4 d6 d4 Nf6 Nc3 c6
B10|Caro-Kann Defense: Two Knights Attack|e4 c6 Nc3 d5 Nf3
B12|Caro-Kann Defense: Advance Variation|e4 c6 d4 d5 e5
B12|Caro-Kann Defense: Advance, 3...Bf5|e4 c6 d4 d5 e5 Bf5
B12|Caro-Kann Defense: Fantasy Variation|e4 c6 d4 d5 f3
B20|Sicilian Defense: Wing Gambit|e4 c5 b4
B20|Sicilian Defense: Bowdler Attack|e4 c5 Bc4
B21|Sicilian Defense: Smith-Morra Gambit|e4 c5 d4 cxd4 c3
B23|Sicilian Defense: Grand Prix Attack|e4 c5 Nc3 Nc6 f4
B30|Sicilian Defense: Rossolimo Variation|e4 c5 Nf3 Nc6 Bb5
B32|Sicilian Defense: Kalashnikov Variation|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 e5
B90|Sicilian Defense: Najdorf, English Attack|^B90 Be3
B90|Sicilian Defense: Najdorf, Adams Attack|^B90 h3
C00|French Defense: King's Indian Attack|e4 e6 d3
C00|French Defense: Normal Variation|e4 e6 d4 d5
C02|French Defense: Advance, Paulsen Attack|e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3
C10|French Defense: Rubinstein Variation|e4 e6 d4 d5 Nc3 dxe4
C11|French Defense: Steinitz Variation|^C11 e5
C20|King's Pawn Game: Wayward Queen Attack|e4 e5 Qh5
C20|King's Pawn Game: Napoleon Attack|e4 e5 Qf3
C20|Portuguese Opening|e4 e5 Bb5
C20|King's Pawn Game: Alapin Opening|e4 e5 Ne2
C21|Danish Gambit|e4 e5 d4 exd4 c3
C25|Vienna Game: Max Lange Defense|e4 e5 Nc3 Nc6
C30|King's Gambit Declined: Classical Variation|e4 e5 f4 Bc5
C33|King's Gambit Accepted: Bishop's Gambit|e4 e5 f4 exf4 Bc4
C39|King's Gambit Accepted: Kieseritzky Gambit|^C39 g4 Ne5
C40|Latvian Gambit|e4 e5 Nf3 f5
C40|Elephant Gambit|e4 e5 Nf3 d5
C40|Damiano Defense|e4 e5 Nf3 f6
C41|Philidor Defense: Hanham Variation|e4 e5 Nf3 d6 d4 Nd7
C41|Philidor Defense: Exchange Variation|e4 e5 Nf3 d6 d4 exd4 Nxd4
C42|Petrov's Defense: Stafford Gambit|e4 e5 Nf3 Nf6 Nxe5 Nc6
C42|Petrov's Defense: Classical Attack|e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4
C44|Ponziani Opening|e4 e5 Nf3 Nc6 c3
C44|Scotch Game|e4 e5 Nf3 Nc6 d4
C44|Scotch Game: Scotch Gambit|e4 e5 Nf3 Nc6 d4 exd4 Bc4
C44|Scotch Game: Göring Gambit|e4 e5 Nf3 Nc6 d4 exd4 c3
C46|Four Knights Game: Halloween Gambit|e4 e5 Nf3 Nc6 Nc3 Nf6 Nxe5
C47|Four Knights Game: Scotch Variation|^C47 d4
C50|Italian Game: Giuoco Piano|e4 e5 Nf3 Nc6 Bc4 Bc5
C50|Italian Game: Giuoco Pianissimo|e4 e5 Nf3 Nc6 Bc4 Bc5 d3
C50|Italian Game: Hungarian Defense|e4 e5 Nf3 Nc6 Bc4 Be7
C50|Italian Game: Blackburne-Kostić Gambit|e4 e5 Nf3 Nc6 Bc4 Nd4
C55|Italian Game: Two Knights, Modern Bishop's Opening|^C55 d3
C57|Italian Game: Fried Liver Attack|^C57 d5 exd5 Nxd5 Nxf7
C57|Italian Game: Traxler Counterattack|^C57 Bc5
C60|Ruy López: Morphy Defense|^C60 a6
C60|Ruy López: Cozio Defense|^C60 Nge7
C60|Ruy López: Fianchetto Defense|^C60 g6
C67|Ruy López: Berlin Defense, Berlin Wall|^C67 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8
D00|Queen's Pawn Game: Accelerated London System|d4 d5 Bf4
D00|Blackmar-Diemer Gambit|d4 d5 e4
D00|Queen's Pawn Game: Stonewall Attack|d4 d5 e3 Nf6 Bd3
D00|Queen's Pawn Game: Chigorin Variation|d4 d5 Nc3
D00|Rapport-Jobava System|d4 d5 Nc3 Nf6 Bf4
D02|London System|d4 d5 Nf3 Nf6 Bf4
D06|Queen's Gambit Declined: Marshall Defense|d4 d5 c4 Nf6
D06|Queen's Gambit Declined: Austrian Defense|d4 d5 c4 c5
D06|Queen's Gambit Declined: Baltic Defense|d4 d5 c4 Bf5
D10|Slav Defense: Exchange Variation, 3.cxd5|d4 d5 c4 c6 cxd5 cxd5
D20|Queen's Gambit Accepted: Central Variation|d4 d5 c4 dxc4 e4
D30|Queen's Gambit Declined: 3.Nf3|d4 d5 c4 e6 Nf3
D35|Queen's Gambit Declined: Exchange Variation|^D35 cxd5 exd5
D43|Semi-Slav Defense: Moscow Variation|^D43 Bg5 h6
D44|Semi-Slav Defense: Botvinnik Variation|^D44 e4 b5 e5 h6 Bh4 g5 Nxg5
E20|Nimzo-Indian Defense: Kmoch Variation|^E20 f3
E60|King's Indian Defense: 3.Nf3|d4 Nf6 c4 g6 Nf3
`;

// Parses the table into [{ code, name, sans: string[] }], expanding ^CODE prefixes.
export function parseEco(text = ECO_TEXT) {
  const first = new Map();
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [code, name, moves] = line.split('|');
    let sans = moves.trim().split(/\s+/);
    if (sans[0].startsWith('^')) {
      const base = first.get(sans[0].slice(1));
      if (!base) throw new Error(`ECO line ${code} "${name}" references unknown ${sans[0]}`);
      sans = base.concat(sans.slice(1));
    }
    if (!first.has(code)) first.set(code, sans);
    out.push({ code, name, sans });
  }
  return out;
}
