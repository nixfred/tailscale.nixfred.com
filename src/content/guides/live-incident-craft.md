---
slug: live-incident-craft
title: Live incident craft
description: How to run a live high pressure incident call as the technical owner, from the first five minutes through the theory board, the async handoff, and the write up.
track: fieldcraft
order: 4
words: 3200
sources:
  - id: kb-troubleshooting
    url: https://tailscale.com/kb/1023/troubleshooting
    title: Troubleshooting guide
    checked: 2026-08-10
  - id: kb-cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
---

## What a live call actually is

A live incident call is not a debugging session that happens to have an audience. It is a trust exercise that happens to involve debugging. The Customer joined the bridge because something they depend on is broken, they cannot fix it themselves, and they need to know two things at every moment: is anyone competent working this, and is that work moving. Everything in this module serves those two signals.

The technical problem and the call are separate workloads, and they compete for the same brain. The engineers who are good at this are not smarter than everyone else. They have a structure that lets them think about the problem while the structure carries the call. That structure is what this module teaches: a first five minutes script, a theory board you run out loud, a narration discipline, a rule for saying "I do not know yet," a decision test for going async, a closing ritual, and a write up format.

One framing rule before anything else: on a live call you are the technical owner. Not the most senior person present, not the account owner, not the person who filed the ticket. The technical owner is the person who holds the current theory of the failure and decides what gets tested next. If that is you, act like it from the first minute, because a call with no technical owner produces forty minutes of people reading logs at each other.

> [!FROM-THE-FIELD]
> The single most common failure mode on incident bridges is not wrong theories. It is silence. An engineer goes heads down in a terminal for six minutes, finds something interesting, keeps pulling the thread, and surfaces with a half answer. To the engineer that was six minutes of excellent work. To the Customer it was six minutes of dead air during an outage, and dead air during an outage reads as "nobody knows what is happening." You can be actively saving the day and still be failing the call.

## The first five minutes

The first five minutes decide the shape of the next hour. Resist the pull to start debugging immediately, because debugging without a frame means debugging the wrong thing confidently. You need three facts on the table before you touch a terminal, and you get them by asking, out loud, in this order.

**Establish impact.** What is actually broken, for whom, right now? Not the Customer's diagnosis ("the VPN is down") but the observable symptom ("users in the warehouse cannot reach the inventory app on node-a since about 9:40"). Push past the summary to specifics: is it all users or some, all destinations or one, total failure or degraded? Impact scopes the problem and sets the urgency honestly. A total outage and a single slow path get different pacing, and pretending otherwise wastes either trust or time.

**Establish timeline.** When did this start, as precisely as anyone can say? When was it last known working? Was the onset sharp or gradual? A sharp onset at 9:41 points at an event. A gradual degradation over a week points at drift, growth, or an expiring credential. The timeline is the spine every piece of evidence gets pinned to for the rest of the call, so get it early and say it back: "So this was working at 9:30, broken by 9:45, and nothing has recovered on its own since. Everyone agree?"

**Establish what changed.** In the window before onset, what changed anywhere near this system? Deploys, config pushes, ACL edits, key rotations, OS updates, network changes, vendor maintenance, DNS changes. Ask the question even though the first answer is almost always "nothing changed." That answer is almost never true; it means "nothing I personally changed that I currently connect to this symptom." Ask again in specifics: any changes to the tailnet policy file? Any nodes re-authenticated? Any infrastructure work last night? The change that caused the incident is usually in the room, unmentioned, because its owner has not connected it to the symptom yet.

Then say the frame back in one breath: "Here is what I have. Warehouse users lost access to the inventory app at roughly 9:41, sharp onset, other apps unaffected, and there was an ACL change deployed at 9:35. That change is my starting theory. I am going to verify connectivity from an affected node now." Thirty seconds of speech, and the call now has a shared model, a leading theory, and visible motion.

<div class="diagram-wrap">
<svg viewBox="0 0 720 260" role="img" aria-label="The first five minutes: impact, timeline, and what changed feed a spoken frame that starts the investigation">
  <title>The first five minutes of an incident call</title>
  <rect x="20" y="30" width="180" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="110" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="14">1. Impact</text>
  <text x="110" y="75" text-anchor="middle" fill="var(--diagram-text)" font-size="11">who, what, how broken</text>
  <rect x="20" y="105" width="180" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="110" y="130" text-anchor="middle" fill="var(--diagram-text)" font-size="14">2. Timeline</text>
  <text x="110" y="150" text-anchor="middle" fill="var(--diagram-text)" font-size="11">last good, first bad</text>
  <rect x="20" y="180" width="180" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="110" y="205" text-anchor="middle" fill="var(--diagram-text)" font-size="14">3. What changed</text>
  <text x="110" y="225" text-anchor="middle" fill="var(--diagram-text)" font-size="11">ask twice, in specifics</text>
  <line x1="200" y1="60" x2="280" y2="120" stroke="var(--diagram-line)"/>
  <line x1="200" y1="135" x2="280" y2="135" stroke="var(--diagram-line)"/>
  <line x1="200" y1="210" x2="280" y2="150" stroke="var(--diagram-line)"/>
  <rect x="285" y="95" width="200" height="80" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="385" y="125" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Spoken frame</text>
  <text x="385" y="145" text-anchor="middle" fill="var(--diagram-text)" font-size="11">"here is what I have..."</text>
  <line x1="485" y1="135" x2="545" y2="135" stroke="var(--diagram-line)"/>
  <polygon points="545,130 555,135 545,140" fill="var(--diagram-line)"/>
  <rect x="560" y="95" width="140" height="80" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="630" y="125" text-anchor="middle" fill="var(--diagram-text)" font-size="14">First theory,</text>
  <text x="630" y="145" text-anchor="middle" fill="var(--diagram-text)" font-size="14">first test</text>
</svg>
</div>

> [!GOTCHA]
> Do not let the Customer's diagnosis become your frame. "The VPN is down" arrives sounding like impact but it is actually a theory, and adopting it silently means you inherit its blind spots. Translate every diagnosis you are handed back into symptoms ("what did you observe that tells you that?") before you pin it to the timeline. Half the time the observation supports a much narrower and more useful frame than the diagnosis did.

## Running the theory board out loud

Once you have a frame, the investigation is a loop: hold one leading theory, test it, keep it or kill it, repeat. Everyone debugs this way internally. The craft on a live call is doing it out loud, as a visible board with three columns you keep repeating.

**Current leading theory.** One sentence, stated as a claim about a mechanism, not a vibe. "The 9:35 ACL change removed the rule that allowed warehouse nodes to reach node-a on port 443" is a theory. "Something with the ACLs" is not, because it cannot be tested or killed.

**Evidence for.** Why this theory leads. Onset lines up with the change, the failure scope matches the rule's scope, the symptom is a clean block rather than a timeout.

**Evidence that would kill it.** This is the column that separates investigation from confirmation bias, and it is the one engineers skip. Before you run a test, say what result would falsify the theory: "If a warehouse node can reach node-a on 443 right now, this theory is dead." Then run the test. Stating the kill condition first does three things: it forces the theory to be concrete, it commits you to honoring an inconvenient result, and it shows the Customer you are hunting the truth rather than defending a guess.

The loop sounds like this in practice: "Leading theory: the ACL change. Evidence for: timing and scope. Kill test: I will run a connectivity check from an affected node to node-a; if traffic passes, the theory dies. Running it now." Then the result: "Traffic is blocked at the destination. Theory survives, and I am promoting it. Next I want the diff of that ACL change." When a theory dies, say that just as plainly: "That kills the ACL theory. Traffic passes fine from node-b, so the block is not policy. New leading theory: the app on node-a itself. Here is why."

Killed theories are progress and you should frame them that way. "We have ruled out policy and basic connectivity, which means this is on the host" is a sentence that moves the call forward. A silent engineer who has ruled out three things sounds identical to a silent engineer who has learned nothing.

<div class="diagram-wrap">
<svg viewBox="0 0 720 300" role="img" aria-label="Theory board loop: state theory, state kill test, run test, then promote or kill and pick the next theory">
  <title>The theory board loop</title>
  <rect x="40" y="30" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="140" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="13">State leading theory</text>
  <text x="140" y="78" text-anchor="middle" fill="var(--diagram-text)" font-size="11">one testable claim</text>
  <line x1="240" y1="65" x2="300" y2="65" stroke="var(--diagram-line)"/>
  <polygon points="300,60 310,65 300,70" fill="var(--diagram-line)"/>
  <rect x="315" y="30" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="415" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="13">State kill test first</text>
  <text x="415" y="78" text-anchor="middle" fill="var(--diagram-text)" font-size="11">"if X, theory is dead"</text>
  <line x1="515" y1="65" x2="575" y2="65" stroke="var(--diagram-line)"/>
  <polygon points="575,60 585,65 575,70" fill="var(--diagram-line)"/>
  <rect x="590" y="30" width="110" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="645" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Run test</text>
  <line x1="645" y1="100" x2="645" y2="150" stroke="var(--diagram-line)"/>
  <polygon points="640,150 645,160 650,150 640,150" fill="var(--diagram-line)"/>
  <rect x="545" y="165" width="160" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="625" y="200" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Result?</text>
  <line x1="545" y1="195" x2="420" y2="195" stroke="var(--diagram-line)"/>
  <polygon points="420,190 410,195 420,200" fill="var(--diagram-line)"/>
  <text x="480" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="11">survives</text>
  <rect x="250" y="165" width="160" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="330" y="190" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Promote, go deeper</text>
  <text x="330" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">narrower theory</text>
  <line x1="625" y1="225" x2="625" y2="260" stroke="var(--diagram-line)"/>
  <polygon points="620,260 625,270 630,260 620,260" fill="var(--diagram-line)"/>
  <text x="660" y="248" text-anchor="middle" fill="var(--diagram-text)" font-size="11">dies</text>
  <rect x="470" y="270" width="230" height="25" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="585" y="287" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Announce the kill: it is progress</text>
  <line x1="470" y1="282" x2="140" y2="282" stroke="var(--diagram-line)"/>
  <line x1="140" y1="282" x2="140" y2="110" stroke="var(--diagram-line)"/>
  <polygon points="135,110 140,100 145,110 135,110" fill="var(--diagram-line)"/>
  <text x="205" y="272" text-anchor="middle" fill="var(--diagram-text)" font-size="11">next theory from ruled-out space</text>
</svg>
</div>

## Narrating without hand waving

Narration is how the Customer sees motion. The mistake is thinking narration means talking constantly. It means marking transitions. You speak at four moments: when you start something ("I am checking whether the affected node can reach node-a directly"), when you get a result ("it cannot, and the failure mode is a block, not a timeout"), when the theory changes, and when you need something from someone ("I need whoever owns the policy file to pull up the 9:35 diff").

Between those moments, silence is fine if you have bounded it: "I am going to be quiet for about three minutes while I read this log." Bounded silence reads as focus. Unbounded silence reads as absence.

Concreteness is what separates narration from hand waving. In a Tailscale context the difference sounds like this. Hand waving: "I am checking the network." Narration: "I am running `tailscale status` on the affected node to see the state of its connections to its peers, then `tailscale ping node-a` to test the path over the tailnet specifically, because that isolates the tailnet layer from the application. If the ping works and the app still fails, this is not a connectivity problem." Same work, but the second version teaches the Customer your model of the system, and a Customer who understands your model stops asking "any update?" because they can see where you are in it.

> [!HOW-IT-WORKS]
> This is also why the narrated version is better engineering, not just better theater. Each named tool binds a theory to a layer. `tailscale status` tests "does this node have working connections to other devices at all." `tailscale ping` tests "does the tailnet path to that specific peer work," pinging exclusively over Tailscale with connection detail useful for troubleshooting. `tailscale netcheck` tests "is the physical network under the node healthy," reporting UDP support, NAT details, and latency to DERP relays. Saying which tool and why forces you to know which layer your current theory lives in. If you cannot name the layer you are testing, you are not testing a theory, you are wandering.

Two narration rules that pay for themselves. First, never speculate upward: do not float causes to the Customer that you have not promoted to leading theory, because every speculative cause you mention becomes a fact in someone's notes and you will spend the postmortem unwinding it. Second, never assign blame mid-call, even to a vendor, even to a config, even when you are sure. "The 9:35 change is my leading theory" is a claim about your investigation. "Your team broke it at 9:35" is a claim about people, and it changes the room instantly and never in a useful direction.

## Saying "I do not know yet"

At some point on every real incident you will be asked a question you cannot answer: what caused this, when will it be fixed, is data affected. The pressure to produce an answer is enormous, and yielding to it is the most expensive mistake in this entire module, because a confident wrong answer costs you the thing the call runs on.

The discipline is a fixed sentence shape: "I do not know yet. Here is how we find out." The second half is mandatory. "I do not know" alone is an ending; with the second half it is a plan. "I do not know whether data was affected yet. Here is how we find out: once we confirm the block was at the policy layer, we will know requests were rejected outright rather than partially processed, and I will be able to answer definitively. I expect to know within the hour."

Notice what that does. It replaces a guess with a method, it names the evidence that will settle the question, and it attaches a time. Customers do not actually need you to know everything. They need to trust what you say, and the fastest way to build that trust is to visibly refuse to guess. The engineer who says "I do not know yet, here is how we find out" three times and is then precisely right the fourth time owns the room. The engineer who guessed three times does not get a fourth.

The same shape works for the estimate question. "When will it be fixed" before you have a confirmed cause deserves: "I cannot give you a fix time yet because I do not have a confirmed cause, and a fix time without a cause would be a guess. What I can commit to: we will have the cause confirmed or ruled out within thirty minutes, and I will give you a real estimate at that point." That is an answer. It is not the answer they wanted, but it is one they can plan around, which is what an answer is for.

## When to stop live debugging and go async

Live calls have a failure mode where they outlive their usefulness: eight people on a bridge watching one person read logs. The bridge itself has a cost. It burns the Customer's staff, it pressures you toward fast shallow tests over slow decisive ones, and it makes deep work worse. The technical owner decides when the call stops paying rent, and there is a test for it.

Every ten minutes or so, ask yourself two questions. First: is there a live hypothesis I can test in the next few minutes that needs someone on this call, their access, their confirmation, their eyes? If yes, keep going, the bridge is earning its cost. Second, if no: is anyone on this call producing information I cannot get async? If both answers are no, the call is done, and prolonging it is theater.

Certain moments almost always mark the transition. You have confirmed cause and the fix is a change that needs review or a maintenance window. The next step is a long running task: collecting diagnostics with `tailscale bugreport` and working with upstream support, a log trawl, a reproduction attempt in a lab. You are waiting on a third party. Or the incident has been mitigated and only root cause work remains. In all of these, the honest sentence is: "We are at a point where keeping everyone live is not making this faster. Here is what happens next and who owns it, and I would like to take this async."

The credibility of that sentence depends entirely on what follows it, which is the closing ritual.

> [!GOTCHA]
> Going async without a mitigation in place is a different decision than going async after one. If the Customer is still hard down, the bar for ending the call is much higher, and you should say the bar out loud: "Normally I would take this async, but you are still down, so I am staying on until we have a mitigation, even if the next twenty minutes are quiet." Ending a call while the Customer is still bleeding, however rational the reasoning, reads as abandonment. Sometimes the bridge's job is simply to be the place where the Customer can see someone still working.

## Closing the call

Never let an incident call dissolve. Calls that end with "okay, we will keep looking and circle back" have not ended, they have evaporated, and everything discussed evaporates with them. The close is a ritual with three parts, and you perform it out loud before anyone drops.

**Owned next steps.** Every open thread gets exactly one name and one action. Not a team, a name. "I am pulling the policy diff and testing the revert in the lab. Dana is confirming with the app team that node-a's service logs cover the window. Priya is identifying the change approver." A step without an owner is a step that will not happen; every incident veteran has watched "someone should check the logs" go unchecked for two days.

**A time commitment.** When does the Customer hear from you next, regardless of progress? "You will have a written update from me by 2:00pm even if the update is that we are still testing." The commitment is to communication, not to resolution, which means you can always keep it, and keeping it is the point. An update that says "no change, next update at 4:00" maintains trust. Silence until you have good news destroys it, because from the Customer's side silence and abandonment are indistinguishable.

**The state of the record.** Say where the ongoing record lives: the ticket, the shared channel, the doc. One place, named on the call, so nobody is reconstructing the incident from four chat fragments tomorrow.

Then, before you drop, restate the whole board once in under a minute: impact, timeline, leading theory, what has been ruled out, next steps with owners, next update time. This sixty second summary is the highest leverage minute of the entire call. It is what everyone actually remembers, and it becomes the skeleton of the write up.

## The write up after

The write up is not paperwork after the incident; it is the last act of the incident. Until it exists, the incident lives in fragments across a bridge recording nobody will replay and the memories of people who each heard a different call. Write it the same day while the ordering of events is still cheap to reconstruct, and keep it short enough that it gets read.

The shape mirrors the call, which is why running the call well makes the write up nearly free:

**Impact.** What broke, for whom, from when to when. Numbers where you have them.

**Timeline.** Timestamped, factual, no interpretation mixed in. First bad moment, detection, key findings, mitigation, resolution. The interpretation goes in the next section, and keeping them separate matters, because the timeline is what everyone must agree on even when they disagree about the cause.

**Cause.** The mechanism, stated the same way you stated theories on the call: as a claim about the system. Include the theories you killed and what killed them. This is not padding; it is the part a future engineer facing similar symptoms will actually reuse, and it shows the Customer the investigation was a hunt, not a lucky guess.

**What we are doing about it.** Each item with an owner and a date, in the same discipline as the call close. Distinguish "done," "committed with a date," and "under consideration" honestly. A write up that promises six improvements and delivers one teaches the Customer to discount everything you write.

**What we still do not know.** If open questions remain, say so, with the method for closing them. The write up is the last place to apply the "I do not know yet, here is how we find out" discipline, and applying it in writing, where it can be checked later, is what makes the next incident call with this Customer start from trust instead of from zero.

Send it to the Customer proactively. A write up they had to ask for is worth half of one that arrived unprompted, because the unprompted one says the thing every part of this module is designed to say: someone owns this, and the work is still moving even when you cannot see it.

> [!FROM-THE-FIELD]
> Keep a private version of the write up too, even three bullets: what slowed the investigation down, which theory you should have reached sooner, what diagnostic you wished existed. The Customer-facing write up improves the system. The private one improves you, and after a dozen incidents it becomes the checklist in your head that makes the first five minutes of the next call automatic.

## Cross references

- Module 11 covers the diagnostic tools referenced in the narration examples in depth: status, ping, netcheck, bugreport, and how to read what they return.
- Module 03 explains the path and relay mechanics behind connectivity theories you will state on calls about unreachable peers.
- Module 05 covers policy evaluation, the layer implicated in this module's running ACL example.
- Module 02 explains the control plane, the layer to reason about when nodes lose state that connectivity tests alone cannot explain.
- Module 10 covers the operational practices (logging, alerting, change discipline) that determine how much evidence exists before your call starts.
