# AI coding transcript

The brief asks for the complete AI coding transcript when AI tools were used.
This project was built with Claude Code (Anthropic) in one session. This
folder holds that session from my first message to the last reply of the
build.

| | |
|---|---|
| Tool | Claude Code, desktop app |
| Transcript | 2026-11-24 23:02 to 2026-11-25 02:52 (UTC+8, the time zone of the git commits) |
| Commits made in it | all 37 on `main` up to `2072963` (first 23:18, last 02:02) |
| Messages from me | 12 |
| Main session | every reply by `claude-fable-5-2`, 369 tool calls |
| Sub-agents | 35 in six workflow runs (19 on `claude-fable-5-2`, 16 on Opus), with 2,017 tool calls of their own, and one page reader on `claude-haiku-5-5` |

Messages are verbatim, the times are the recorded ones, and the order is the
order of the export. Nothing was rewritten.

## The session

| Part | Covers |
|---|---|
| [session-01.md](session-01.md) | Turns 1 and 2: reading the brief, the design, the gateway and its tests, a trial load run and three full ones, starting the sub-agents that build the mock carrier, load script and dashboard, starting the backend review, the first push and CI |
| [session-02.md](session-02.md) | Turns 3 to 10: making the repo public, research into the dashboard's look, starting three competing mock-ups, logical commits, the Codespaces button |
| [session-03.md](session-03.md) | Turns 11 and 12: the backend review's results and their fixes, the first dashboard and its commits, the mock-ups judged and "Ledger" chosen, the dashboard restyle, CI with the full load test in Docker, the README load output, screenshots, the final push |

Each message I sent, with the time it was sent:

| Turn | Time (UTC+8) | Message |
|---|---|---|
| [1](session-01.md#turn-1) | 11-24 23:02 | `@"C:\Users\Ico\Downloads\DCC_SMS_Gateway_Take_Home_Assignment-v2.docx"` make a github repo make good visuals and research best frontend, act as the best full stack engineer |
| [2](session-01.md#turn-2) | 11-25 00:00 | continue |
| [3](session-02.md#turn-3) | 11-25 00:02 | why github repo is private |
| [4](session-02.md#turn-4) | 11-25 00:07 | what is in the instruction |
| [5](session-02.md#turn-5) | 11-25 00:08 | then make it public |
| [6](session-02.md#turn-6) | 11-25 00:14 | make the ui not ai slop, research act as teh best rontend developer |
| [7](session-02.md#turn-7) | 11-25 00:26 | maybe fable for planning and use opus sub agents |
| [8](session-02.md#turn-8) | 11-25 00:28 | push everthing not one shot push |
| [9](session-02.md#turn-9) | 11-25 00:30 | cant it be live in github |
| [10](session-02.md#turn-10) | 11-25 00:32 | Add Codespaces button |
| [11](session-03.md#turn-11) | 11-25 00:33 | push all give me finished and also make the ui premium add colors that loks so a good act as the bet frontend developer, make it look aesetthic and not ai slop |
| [12](session-03.md#turn-12) | 11-25 02:51 | Keep them running |

Turns 2, 3 and 6 were typed while the previous turn was still running; the
transcript marks them.

## The sub-agents

The main session wrote the gateway. Sub-agents, started by the main session
through workflow scripts, wrote the mock carrier, the load script and the
dashboard, reviewed the gateway and fixed 14 of the 15 problems the review
found. Each file below has the script and what the sub-agents returned. The
script holds the prompt templates. Some prompts were filled in at run time
with text that is not in these files: a reviewer's findings passed to its
skeptic, or a longer copy of an earlier report. Some prompts also point to a
working file outside the repository, such as the design brief, which the
sub-agents read themselves.

| Run | Started | Minutes | Sub-agents | Their tool calls | Model | What it did |
|---|---|---|---|---|---|---|
| [build-satellites](workflows/01-build-satellites.md) | 23:20 | 88.8 | 6 | 546 | Fable | Three builders wrote the mock carrier, the load script and the dashboard against the written API contract; two reviewers checked the dashboard and one fixer applied the confirmed findings |
| [adversarial-backend-review](workflows/02-adversarial-backend-review.md) | 23:56 | 42.6 | 10 | 380 | Fable | Five reviewers looked for bugs in the gateway from different angles; five skeptics tried to refute each finding (21 survived, 2 refuted) |
| [dashboard-art-direction](workflows/03-dashboard-art-direction.md) | 00:18 | 9.3 | 3 | 31 | Fable | Stopped after turn 7 and started again on Opus |
| [dashboard-art-direction](workflows/04-dashboard-art-direction.md) | 00:27 | 17.5 | 6 | 229 | Opus | Three mock-ups of the dashboard and three judges; "Ledger" won 2 to 1 |
| [fix-backend-review-findings](workflows/05-fix-backend-review-findings.md) | 00:40 | 28.9 | 3 | 157 | Opus | Fixed 14 of the 15 distinct problems that survived the review, 13 of them with a regression test (the load script has no test suite); a second agent verified the fixes and a third fixed its three small notes. The fifteenth, that this transcript was missing, was left to me |
| [restyle-dashboard-ledger](workflows/06-restyle-dashboard-ledger.md) | 00:51 | 69.2 | 7 | 674 | Opus | Restyled the dashboard in the chosen direction, with existing tests kept passing and some small behaviour changes noted in the reports: a foundation, three page builders, two screenshot critics, one polish pass |

The runs overlap: the main session kept working while they ran.
The page reader is a single sub-agent that was given four pages on
generic-looking UI during turn 6. It could read three; one refused access. Its
report is in [session-02.md](session-02.md#turn-6).

## How to read a part

- **User** is a message I typed.
- **Claude** is text the model wrote to me. **Claude (reasoning summary)** is a
  one-line note the model kept about its reasoning between steps.
- **Tool** is an action the model took: a shell command, a file it wrote, a
  plan update, a workflow it started. The result is folded under "Result".
- A line in italics is a note. Either it comes from the app, such as a
  background task ending, or the script that made these files added it, such
  as a link to a workflow file or a marker for removed content.

## What is left out, and why

The files were produced from the raw session export by a script. It changes
nothing in what was said; it leaves these things out:

- **Text beyond a readable length.** Long tool output, and some long commands
  and scripts, are cut, and each cut is marked with the number of characters
  dropped. Files written with the Write tool are shown by path and line count
only (a file written by a shell command shows up inside that command). Files in the
  repository are in its history; a few working files outside it (screenshot
  scripts, the design brief, research notes, one-off edit scripts) were not
  kept.
- **Most of the model's reasoning.** The export holds 212 reasoning blocks.
  17 of them carry the short summary shown in the transcript; the rest are not
  stored in readable form.
- **The app's own plumbing:** the system prompt, the instruction text of the
  skills it loaded, and automatic reminders.
- **The content of my CV file.** My Claude Code setup has a private skill with
  my CV details for filling in application forms. The session loaded it at the
  start (turn 1, 23:02) and read one of its files (23:03). Both calls are shown;
  the file's content is replaced by a marker. Four strings elsewhere were
  replaced by `[personal detail removed]`. They are all in one command, in
  turn 5, that scanned the repository for such details before it was made
  public.
- **The sub-agents' own step-by-step logs** (about 140 MB). Their prompts and
  their final reports are in `workflows/`. Some reports stop mid-sentence: the
  workflow script itself cut them before returning them, as each file notes.
- **Later turns of the same session, after the last commit.** They are not
  about building the project: a status check, restarting the local test
  services, a reply to an email, and producing this folder. The only change
  they made to the repository is this folder.

Commits written by the model carry a `Co-Authored-By: Claude` trailer.
