# Clear Point — Voice Agent Call-Scope & Closure Spec (System B)

**Date:** 2026-08-28 · **Applies to:** GoHighLevel Voice AI agents — Emely (EN, agent `6a6375c8df9038810f0b6d0b`, line 631-658-3796) and Sofia (ES, agent `6a639514df903842e40b939b`, line 940-477-8518), fed by the Bilingual IVR on 1-855-720-8555.
**Source:** Master conversational-platform spec 2026-08-28 §§8–10, 32–39, 95–97. **System B is separate from the web agents (Clara/Zara) by design — no shared logic is assumed.**

## 1. The problem this closes

A caller who dialed the wrong number, or wants something Clear Point does not do, today receives minutes of well-meaning "help" — wasted minutes, occupied lines, contaminated metrics, junk CRM contacts.

**Target:** with HIGH confidence of wrong-number/out-of-scope, resolve the call warmly in **~20–60 seconds** — never coldly, never rigidly (a confused or vulnerable caller may take longer; that is correct behavior, not a violation).

## 2. First-30-seconds logic (§33)

1. Greeting + identity ("Thank you for calling Clear Point Senior Advisors…").
2. Open question: "How can I help you today?"
3. Silently classify: IN-SCOPE (Medicare/health coverage/appointment/existing client) · WRONG_BUSINESS · VENDOR · SPAM/ROBOCALL · UNCLEAR.
4. UNCLEAR → max 2 short clarifications (offer concrete options), then route or close.
5. Never open with an interrogation; never wait minutes to discover it's a pizza order.

## 3. Add-on prompt block — EMELY (paste at the END of EMELY_MASTER_PROMPT_V1)

```
── CALL SCOPE & CLOSURE POLICY (2026-08-28) ──
Clear Point Senior Advisors helps ONLY with: Medicare and health-coverage
questions, appointments with a licensed advisor, and existing Clear Point
clients. Everything else is OUT OF SCOPE.

WRONG NUMBER / WRONG BUSINESS (caller wants a hospital, pharmacy refill for
another company, bank, internet/cable, packages, tech support, another
person, any non-health business):
- Do NOT try to solve their problem. Do NOT look up or guess phone numbers,
  addresses, or steps for other organizations. You are not a general
  assistant or a search engine.
- Say, warmly and once: "I'm sorry you're dealing with that. You've reached
  Clear Point Senior Advisors — we help with Medicare and health insurance
  matters. It sounds like you were trying to reach a different organization,
  and I don't want to keep you on the line unnecessarily. Please double-check
  the number you were given. I hope you reach them quickly. Have a good day."
- Then END the call. If the caller pushes once more ("but maybe you know…"),
  reply exactly once: "I understand, but I don't have access to that
  organization's information and I wouldn't want to give you something
  incorrect." Then end the call politely.
- EXCEPTION — never rush: if the caller sounds confused, elderly, or
  mentions ANYTHING about Medicare, health coverage, a health plan, a card,
  a doctor, or help paying for care — treat the call as IN SCOPE and help.

SALES / VENDORS / RECRUITERS (SEO, marketing, lead sellers, web design,
merchant services, "can I speak with the owner"):
- One sentence: "Thank you — Clear Point doesn't handle business
  solicitations on this line." Do not gather their pitch, do not take a
  message, do not promise a callback. End the call politely.

SPAM / ROBOCALLS / SILENCE:
- Prerecorded pitch or synthetic audio: end the call without conversation.
- Silence: prompt once briefly ("Hello — can you hear me?"). Second silence:
  "It seems we can't hear each other. Please call us back at 855-720-8555.
  Goodbye." End the call.

STALLED CALLS: if after 2 clarification attempts you still cannot identify
a Medicare/health need, say: "I want to be respectful of your time — I'm
not managing to identify what you need. You're welcome to call back, or if
your question is about Medicare or health coverage, tell me in a few words."
One more unclear turn → close politely.

STYLE FOR EVERY CLOSURE: calm, warm, unhurried delivery; short sentences;
never abrupt, never argumentative, never robotic; allow interruptions and
stop speaking when the caller starts talking.
```

## 4. Add-on prompt block — SOFIA (pegar al FINAL de Sofia-Master-v4.0)

```
── POLÍTICA DE ALCANCE Y CIERRE DE LLAMADAS (2026-08-28) ──
Clear Point Senior Advisors ayuda ÚNICAMENTE con: preguntas de Medicare y
cobertura de salud, citas con un asesor licenciado, y clientes existentes de
Clear Point. Todo lo demás está FUERA DE ALCANCE.

NÚMERO EQUIVOCADO / OTRO NEGOCIO (hospital, farmacia de otra compañía,
banco, internet/cable, paquetes, soporte técnico, otra persona, cualquier
negocio ajeno a salud):
- NO intente resolver su problema. NO busque ni adivine teléfonos,
  direcciones ni pasos de otras organizaciones. Usted no es una asistente
  general ni un buscador.
- Diga, con calidez y una sola vez: "Lamento que esté pasando por eso. Ha
  llamado a Clear Point Senior Advisors — ayudamos con temas de Medicare y
  seguros de salud. Por lo que me comenta, parece que intentaba comunicarse
  con otra organización, y no quisiera hacerle perder más tiempo. Le
  recomiendo verificar el número que le proporcionaron. Espero que pueda
  comunicarse pronto. Que tenga muy buen día."
- Luego TERMINE la llamada. Si la persona insiste una vez ("pero quizás
  usted sabe…"), responda exactamente una vez: "Entiendo, pero no tengo
  acceso a la información de esa organización y no quisiera darle un dato
  incorrecto." Y despídase cortésmente.
- EXCEPCIÓN — nunca apurar: si la persona suena confundida, es un adulto
  mayor, o menciona CUALQUIER cosa de Medicare, cobertura, un plan de salud,
  una tarjeta, un doctor o ayuda para pagar su atención — trate la llamada
  como DENTRO de alcance y ayude.

VENDEDORES / RECLUTADORES (SEO, marketing, venta de leads, diseño web,
servicios de pago, "quiero hablar con el dueño"):
- Una sola frase: "Gracias — Clear Point no gestiona solicitudes comerciales
  por esta línea." No escuche el pitch completo, no tome recado, no prometa
  llamada de vuelta. Despídase cortésmente.

SPAM / ROBOLLAMADAS / SILENCIO:
- Mensaje pregrabado o audio sintético: termine la llamada sin conversar.
- Silencio: pregunte una vez ("¿Hola? ¿Me escucha?"). Segundo silencio:
  "Parece que no nos escuchamos. Por favor llámenos de nuevo al
  855-720-8555. Hasta luego." Termine la llamada.

LLAMADAS ESTANCADAS: si tras 2 intentos de aclaración no logra identificar
una necesidad de Medicare/salud, diga: "Quiero respetar su tiempo — no estoy
logrando identificar lo que necesita. Puede volver a llamarnos, o si su
pregunta es sobre Medicare o cobertura de salud, dígamela en pocas palabras."
Un turno más sin claridad → cierre cortés.

ESTILO EN TODO CIERRE: tono cálido y sin prisa, trato de usted, frases
cortas; nunca brusca, nunca discute, nunca robótica; permita interrupciones
y deje de hablar cuando la persona empiece a hablar.
```

## 5. Tagging & CRM hygiene (§74–§77)

Where GHL workflow/Voice AI configuration allows, tag calls: `AI_VOICE_ENGLISH` / `AI_VOICE_SPANISH` plus one of `AI_WRONG_NUMBER`, `AI_VENDOR`, `AI_SPAM`, `AI_QUALIFIED`, `AI_APPOINTMENT`, `AI_ESCALATED`. Wrong-number/vendor/spam calls must NOT create qualified-lead contacts or enter nurture campaigns. (Whether Voice AI can tag conditionally depends on the GHL post-call workflow — see BLOCKED item V2.)

## 6. Rollout runbook (STAGED — live phone lines)

1. **Backup first:** copy the current full prompt text of both agents (GHL → AI Agents → Emely / Sofia) into `docs/voice/backups/<date>-<agent>.txt`. Rollback = paste it back.
2. Paste the add-on block at the END of each agent's prompt. Save.
3. Wait ~5–10 min (GHL edge propagation — verified 2026-08-03).
4. Test with real calls (dialer or cell): (a) wrong-number script — "I'm calling about my internet bill"; expect the warm close in under a minute; (b) vendor pitch; (c) a REAL Medicare question — must behave exactly as before; (d) Spanish twins on the 940 line.
5. Watch the first day of call logs for false positives (a real beneficiary closed early = rollback and tighten the exception wording).

**Status: NOT APPLIED to the live agents yet.** Reason: these are live production phone lines and the change cannot be verified without real calls. Owner GO + a test window is the gate (5 minutes of work + 4 test calls).

## 7. Metrics to watch (§108)

- Average duration of wrong-number calls (baseline: minutes → target: ≤60s).
- `Wrong Number Minutes Saved` = (baseline avg − new avg) × wrong-number call count.
- False-positive check: any call tagged wrong-number whose transcript mentions Medicare/health → review weekly.

## 8. APPLIED 2026-09-27 — AI identity + recording disclosure + determinism rules (owner GO)

**What changed in the live agents (verified by fresh read-back after save, `docs/voice/backups/2026-09-27-*-after.txt`):**

- **Emely — Agent's Initial Message** (63 → 143 chars): `Clear Point Client Services, this is Emely, an automated assistant. This call is being recorded for quality and compliance. How can I help you?`
- **Sofía — Agent's Initial Message** (109 → 171 chars): `Hola, le habla Sofía, la asistente automatizada de Clear Point. Esta llamada está siendo grabada con fines de calidad y cumplimiento. Cuénteme, ¿en qué puedo ayudarle hoy?`
- **Both prompts** (`CLEARPOINT_CS_MASTER_V2` → `V2.1`): new block **DETERMINISM & DISCLOSURE RULES** / **REGLAS DE DETERMINISMO Y AVISO** inserted before the VERSION line (verbatim one-sentence answer when asked "are you human / is this recorded", fixed lines spoken word-for-word, PRIORITY 0 table is the only classifier, never invent, one question then act, no improvisation). `RECORDING_RETENTION_POLICY` rewritten: all calls on the line are recorded, disclosed in the opening line. Sofía's transfer-arrival greeting now also states automated assistant + recording.
- The §3/§4 add-on blocks of this spec were **not** pasted: both prompts already carried the stronger `PRIORITY 0 — CALL SCOPE CONTROL` block since 2026-08-11.
- **Sofía only:** the checkbox "Trigger Workflow when call is completed" was ON with no workflow selected; that dangling state made the Agent Goals form fail validation silently (Save sent no request). It was unchecked (functional no-op: nothing was bound; Emely already had it off). Re-enable it once a real post-call workflow exists.

**Observed platform facts (read-only, 2026-09-27):** Call Recording is ON on all three numbers. Number-level recording message: 631 and 940 = "This call will be recorded for quality purposes" (English, also on the Spanish line); **855 (main line, Bilingual IVR) has NO recording message** — its greeting is an uploaded MP3 (`clearpoint-ivr-greeting-v2.mp3`, 19 s) whose content could not be read. LLM Temperature = 0 ("Stable") on both agents; Idle reminder ON (10 s, 1×); End Call After Silence = 15 s; Sofía voice speed 1.20x (Emely 0.75x). Workflow "CP- Voice Post-Call (Emely & Sofia)" is an empty Draft (trigger only, no actions) — nothing to publish.

**Runtime evidence — 5 live web calls with synthesized caller audio injected as microphone (`scratchpad/ghl/16-*-transcript.txt`):**

| Test | Result |
|---|---|
| Emely, "internet bill" wrong number + "look up their number" (run twice) | New greeting spoken verbatim; wrong-number close at ~0:21; insistence reply verbatim; identical wording across both runs |
| Emely, "real person or computer? is this recorded?" then Part D letter (NJ) | Verbatim §1 sentence; Medicare question handled in scope (asked whether the letter is from Medicare, the Part D plan or SSA) |
| Sofía, "factura de internet" + "¿no me puede buscar el número?" | Greeting verbatim; Spanish wrong-number close and insistence reply verbatim |
| Sofía, "¿persona o máquina? ¿se graba?" then Parte D (NJ) | Verbatim §1 sentence in Spanish; Medicare question handled in scope |

**Also observed:** the "New Action → During The Call" catalog offers only Call transfer, Trigger a workflow, Send SMS, Update contact field, Appointment Booking, Custom action and Agent Transfer — there is **no "End Call" action**, so the prompt's "→ END THE CALL" can only be honoured by the platform's own end-of-conversation logic / End Call After Silence. The five test web calls created no contacts or conversations (newest contact still Sep 19). Per the 2026-08-11 build notes, `clearpoint-ivr-greeting-v2.mp3` is the bilingual menu only (press 1 / press 2, repeated once) — inference, the file itself was not re-listened: the 855 line therefore had **no recording disclosure at all** before this change; now every path (855 → IVR → Emely/Sofía, 631 direct, 940 direct) hears it from the agent's opening line.

**NOT VERIFIED:** automatic hang-up after the closing line. In the web-call harness no call ended on its own within 45–70 s of continuous silence despite "End Call After Silence = 15 s" (platform idle reminders did fire). Verify with a real phone call to 631/940: say the internet-bill script, stay silent after the close, time the hang-up. Also NOT VERIFIED: whether the 855 IVR MP3 mentions recording (owner knows the file's content).

## 8.b APPLIED 2026-09-28 — post-call workflows, voice speed, Spanish recording notice

**Auto-hangup — root cause and status.** The `End call` action does not exist in this sub-account: Settings → Labs (sub-account **and** agency tab) has no "Voice AI: End Call & Spam Protection" feature, searched for "End Call", "Voice AI" and "Spam" in both scopes on 2026-09-27 (screenshots `scratchpad/ghl/25-labs-*.png`). GoHighLevel's own article (modified 4 Sep 2026) says the action only appears after activating that Labs feature, so the capability is simply not available to this account — nothing is misconfigured. Prompt text alone cannot end a call.
**Mitigation applied instead (prompt V2.2, both agents):** rule 7 CLOSING PROTOCOL / PROTOCOLO DE CIERRE — after any close the agent says ONE closing sentence and stays silent; it may not ask "Do you need any further assistance?". Measured effect on real PSTN calls: Emely "thanks only" 0:41 → **0:23**; wrong-number 1:04 → 0:59. Every one of the 10 real calls on 27–28 Sep ended on its own (platform silence timer: idle reminder 10 s + End Call After Silence 15 s), so **auto-hangup works, with a 20–30 s tail after the closing line**. Removing that tail needs the Labs feature (owner: ask GHL support to enable it).

**Post-call automation (built, published, bound, verified in runtime).** Three workflows, all Published:
- `CP- Voice Post-Call (Emely & Sofia)` (`4422302c-…`): no trigger node (the agent-side setting enrolls the contact) → Wait 2 min → Add tag `cp-ai-handled` → If/else **Junk** on CP Last Call Outcome (contains WRONG / SOLICIT / SPAM → `cp-wrong-number` / `cp-vendor` / `cp-spam`, each plus `cp-nurture-exclude`) → None branch → If/else **Escalation** (ESCALAT / TRANSFER → `cp-escalated`; APPOINTMENT → `cp-appointment-booked`) → end. No SMS, no email, no DND, no deletion.
- `CP- Voice Post-Call Lang EN (Emely)` (`cf2bfd42-…`) and `CP- Voice Post-Call Lang ES (Sofia)` (`cf26a43b-…`): one node each (`cp-lang-en` / `cp-lang-es`), because Emely does not write CP Preferred Language.
- Bound in both agents under "Trigger Workflow when call is completed"; PUT 200, selection persists after reload, the 10 After-The-Call actions are unchanged (counted before and after every save).
- Runtime evidence (28 Sep 03:20 and 03:22 real calls): Enrollment history shows `(855) 720-8555 · Voice Ai Api`; Execution logs show Wait → Tag ai handled → NotJunk → Handled → Removed by End Of Workflow; the contact carries `cp-ai-handled`, `cp-lang-en`, `cp-lang-es`; no duplicate contact, no outbound message.

**LIMITATION — disposition tagging is not reliable.** The Junk/Escalation branches read the contact field `CP Last Call Outcome`, and that field is stale: after four calls whose notes state WRONG_DEPARTMENT, INFORMATION_PROVIDED, WRONG_DEPARTMENT and NEW_ELIGIBLE_LEAD, the contact still reads **INFORMATION_PROVIDED** (the 27 Sep 19:54 value) — screenshot `scratchpad/ghl/42-outcome.png`. So the agent's after-call "Save Call Outcome" action wrote once and not on the later calls. Consequence: every call lands in the None branches and gets no disposition tag. Two further observations: the outcome vocabulary the model writes (WRONG_DEPARTMENT, NEW_ELIGIBLE_LEAD, INFORMATION_PROVIDED) is not the vocabulary the prompt defines (WRONG_NUMBER_UNRELATED_*, CLEARPOINT_VALID_CALL…), and a second call arriving inside the 2-minute Wait is skipped by the shared workflow (GHL skips re-entry while still enrolled). Fixing disposition properly means the documented path — a `Transcript Generated` (Call Type = Voice AI) workflow with an AI-intent step — or making the agent write a fixed enum. Not done; owner decision.

**Voice speed — Sofía.** 1.20x (the fast end) → 1.00x → **0.90x** at the owner's ear on 28 Sep; PUT 200 and verified after reload each time. Emely stays 0.75x. Nothing else moved: Response Speed 0.7, Interruption Sensitivity 0.30/0.90, LLM Temperature 0, Voice Temperature 0.55, Voice Volume 100, End Call After Silence 15 s all identical to the backups. The UI slider ignores arrow keys and its rail is not the documented 0.7–1.2 range (1.20x sits at 50%); it must be calibrated by dragging (`scratchpad/ghl/sofia-speed.mjs`).

**Spanish recording notice on 940.** The number-level "Call recording message" was English on the Spanish line. It is now `Esta llamada puede ser grabada para calidad y cumplimiento.` with **Call Recording still ON** (verified by reopening the modal). The message was NOT removed: the line keeps a platform-level disclosure and Sofía repeats it in her opening. 631 and 855 untouched.

## 9. NOT VERIFIED — legal/compliance review required

- Exact disclosure wording requirements for AI voice agents per state (NY/NJ/CT) beyond the current recording disclosure ("This call will be recorded for quality purposes", present on both lines since 2026-08-11). Marked NOT VERIFIED; current scripts do not remove or alter any existing disclosure.
- Whether TPMO disclaimer must be read on INBOUND education-only calls that do not discuss plan specifics. NOT VERIFIED — do not change current behavior without compliance sign-off.
