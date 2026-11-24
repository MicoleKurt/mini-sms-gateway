"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ApiError, describeError } from "@/lib/api/client";
import { usePrices, useTenants } from "@/lib/api/hooks";
import type { AcceptedMessage } from "@/lib/api/schemas";
import { analyze } from "@/lib/sms-encoding";
import {
  MAX_SEGMENTS,
  validateClientRef,
  validateDestination,
  validateSender,
  validateText,
} from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, fieldMessageId } from "@/components/ui/field";
import { Money } from "@/components/ui/figures";
import { Section } from "@/components/ui/section";
import {
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshFailedNotice,
} from "@/components/ui/states";
import { MarkedTextarea } from "./marked-textarea";
import { Preview } from "./preview";
import { lookUpPrice } from "./price-lookup";
import { ResultLine } from "./result-line";
import {
  ENCODING_NAME,
  amountWords,
  UNIT_NAME,
  destinationHint,
  sendButtonLabel,
  sendHeadline,
  senderHint,
} from "./send-copy";
import { explainUcs2 } from "./ucs2-cause";
import { fingerprintOf, useSendMessage, type Draft } from "./use-send-message";
import styles from "./send.module.css";

/** The fields of the request body, by the names the gateway uses in `details[].field`. */
const FIELDS = ["to", "from", "text", "client_ref"] as const;

type FieldName = (typeof FIELDS)[number];

const FIELD_IDS: Record<FieldName, string> = {
  to: "send-to",
  from: "send-from",
  text: "send-text",
  client_ref: "send-client-ref",
};

const EMPTY_VALUES: Record<FieldName, string> = { to: "", from: "", text: "", client_ref: "" };

const ERROR_TITLES: Record<string, string> = {
  INSUFFICIENT_BALANCE: "Not enough balance",
  VALIDATION_ERROR: "The gateway rejected the message",
  GATEWAY_UNREACHABLE: "The gateway is not reachable",
  NETWORK_ERROR: "The request did not get through",
};

interface FormFailure {
  title: string;
  message: string;
  /** Problems the gateway reported that do not belong to one of the form's fields. */
  other: string[];
  /** True when the request may have reached the gateway anyway. */
  canRetrySafely: boolean;
  /** The first field the gateway complained about, if any. Focus goes there. */
  field: FieldName | null;
}

interface SentResult {
  message: AcceptedMessage;
  /** Of the draft that was sent, to tell whether the form still holds it. */
  fingerprint: string;
}

function isFieldName(value: string | undefined): value is FieldName {
  return FIELDS.includes(value as FieldName);
}

function toDraft(tenantId: string, values: Record<FieldName, string>): Draft {
  return {
    tenantId,
    body: {
      to: values.to,
      from: values.from,
      text: values.text,
      ...(values.client_ref !== "" && { client_ref: values.client_ref }),
    },
  };
}

/** The line under the text: units used, and the encoding with its cause. */
function TextHint({ text }: { text: string }) {
  if (text === "") return <>Up to {MAX_SEGMENTS} segments.</>;
  const { encoding, units } = analyze(text);
  const causes = explainUcs2(text)?.causes.length ?? 0;
  return (
    <span className={styles.textFoot}>
      <span>
        <span className="num">{units}</span> {UNIT_NAME[encoding]}
      </span>
      {causes > 0 ? (
        <span className="attn">
          UCS-2 because of {causes === 1 ? "1 character" : `${causes} characters`}
        </span>
      ) : (
        <span>{ENCODING_NAME[encoding]}</span>
      )}
    </span>
  );
}

export function SendView() {
  const tenants = useTenants();
  const prices = usePrices();
  const { send, forgetKey } = useSendMessage();

  const [tenantId, setTenantId] = useState("");
  const [values, setValues] = useState<Record<FieldName, string>>(EMPTY_VALUES);
  const [touched, setTouched] = useState<ReadonlySet<FieldName>>(new Set());
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState<FormFailure | null>(null);
  const [result, setResult] = useState<SentResult | null>(null);
  const failureAlert = useRef<HTMLDivElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);

  // Until the user picks one, the first tenant is selected.
  const tenant = tenants.data?.find(({ id }) => id === tenantId) ?? tenants.data?.[0];
  const currency = tenant?.currency ?? "USD";
  const analysis = analyze(values.text);
  const clientErrors: Record<FieldName, string | null> = {
    to: validateDestination(values.to),
    from: validateSender(values.from),
    text: validateText(values.text, analysis.segments),
    client_ref: validateClientRef(values.client_ref),
  };
  const price = lookUpPrice(prices, values.to, clientErrors.to === null);
  const unsupported = price.state === "unsupported";
  const headline = sendHeadline({
    text: values.text,
    analysis,
    to: values.to,
    destinationError: clientErrors.to,
    price,
    tenant,
  });

  const ready =
    headline.state === "priced" && FIELDS.every((field) => clientErrors[field] === null);
  const draft = tenant ? toDraft(tenant.id, values) : null;
  // The form still holds the message whose result is showing. Submitting it
  // again would be an accidental repeat (a double click, a held Enter key),
  // so it does nothing until the draft changes or the result is cleared.
  const alreadySent = draft !== null && result?.fingerprint === fingerprintOf(draft);

  // After a failure the keyboard position goes to where the problem is: the
  // first field the gateway rejected, or else the failure message itself.
  useEffect(() => {
    if (!failure) return;
    if (failure.field) document.getElementById(FIELD_IDS[failure.field])?.focus();
    else failureAlert.current?.focus();
  }, [failure]);

  // A field shows the gateway's error if there is one, and its own error once
  // the user has left the field or tried to submit. Not while they first type.
  function errorOf(field: FieldName): string | null {
    if (field === "to" && unsupported)
      return "There is no price for this destination, so it can not be sent.";
    return serverErrors[field] ?? (touched.has(field) ? clientErrors[field] : null);
  }

  function change(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
  }

  function touch(field: FieldName) {
    setTouched((current) => new Set(current).add(field));
  }

  function reset() {
    setValues(EMPTY_VALUES);
    setTouched(new Set());
    setServerErrors({});
    setFailure(null);
    document.getElementById(FIELD_IDS.to)?.focus();
  }

  function showFailure(error: unknown) {
    const details = error instanceof ApiError ? error.details : [];
    const code = error instanceof ApiError ? error.code : "";
    const status = error instanceof ApiError ? error.status : 0;

    const byField: Partial<Record<FieldName, string>> = {};
    for (const detail of details) {
      if (isFieldName(detail.field)) byField[detail.field] ??= detail.message;
    }
    setServerErrors(byField);
    setFailure({
      title: ERROR_TITLES[code] ?? "The message was not sent",
      message: describeError(error),
      other: details.filter((detail) => !isFieldName(detail.field)).map((detail) => detail.message),
      canRetrySafely: status === 0 || status >= 500,
      field: FIELDS.find((field) => byField[field] !== undefined) ?? null,
    });
  }

  function clearResult() {
    // Without its key the draft is a new request, so it can be sent again.
    forgetKey();
    setResult(null);
    submitButton.current?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (send.isPending || !draft || unsupported || alreadySent) return;

    setTouched(new Set(FIELDS));
    const firstInvalid = FIELDS.find((field) => clientErrors[field] !== null);
    if (firstInvalid) {
      document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    setFailure(null);
    setServerErrors({});
    // The line of the previous message would contradict a failure of this one.
    setResult(null);
    const fingerprint = fingerprintOf(draft);
    send.mutate(draft, {
      onSuccess: (message) => {
        setResult({ message, fingerprint });
        toast.success("Message accepted", {
          description: `${message.to}, ${amountWords(message.cost_micros, message.currency)}`,
        });
      },
      onError: showFailure,
    });
  }

  /** The props every text control shares: value, handlers and error wiring. */
  function control(field: FieldName) {
    return {
      id: FIELD_IDS[field],
      name: field,
      value: values[field],
      onChange: (event: { target: { value: string } }) => change(field, event.target.value),
      onBlur: () => touch(field),
      "aria-invalid": errorOf(field) !== null || undefined,
      "aria-describedby": fieldMessageId(FIELD_IDS[field]),
    };
  }

  return (
    <Section
      ruled={false}
      context="Goes through the real queue and carrier, and is charged to the tenant like any other message."
    >
      <div className={styles.layout}>
        <div>
          {tenants.isPending ? (
            <LoadingState label="Loading the form" lines={4} />
          ) : tenants.isLoadingError ? (
            <ErrorState
              title="Tenants could not be loaded"
              error={tenants.error}
              onRetry={() => tenants.refetch()}
            />
          ) : !tenant ? (
            <EmptyState
              title="There are no tenants."
              description="The gateway returned an empty tenant list, so there is no one to send as."
            />
          ) : (
            <form onSubmit={submit} noValidate className={styles.form} aria-label="Test message">
              {/* The form stays usable when the tenants can not be refreshed. Only the balance may be old. */}
              <RefreshFailedNotice title="Tenants could not be refreshed" query={tenants} />
              <Field
                htmlFor="send-tenant"
                label="Tenant"
                hint={
                  <>
                    Balance <Money micros={tenant.balance_micros} currency={tenant.currency} />
                  </>
                }
              >
                <Select
                  id="send-tenant"
                  value={tenant.id}
                  onChange={(event) => setTenantId(event.target.value)}
                  aria-describedby={fieldMessageId("send-tenant")}
                >
                  {tenants.data.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                htmlFor={FIELD_IDS.from}
                label="From"
                hint={senderHint(values.from)}
                error={errorOf("from")}
              >
                <Input
                  {...control("from")}
                  autoComplete="off"
                  spellCheck={false}
                  className="mono"
                />
              </Field>

              <Field
                htmlFor={FIELD_IDS.to}
                label="To"
                hint={
                  clientErrors.to === null
                    ? destinationHint(price, currency)
                    : "E.164, for example +8801711000001"
                }
                error={errorOf("to")}
              >
                <Input
                  {...control("to")}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  spellCheck={false}
                  className="mono"
                />
              </Field>

              <Field
                htmlFor={FIELD_IDS.text}
                label="Text"
                hint={<TextHint text={values.text} />}
                error={errorOf("text")}
              >
                <MarkedTextarea {...control("text")} rows={5} />
              </Field>

              <Field
                htmlFor={FIELD_IDS.client_ref}
                label="Client reference"
                optional
                error={errorOf("client_ref")}
              >
                <Input
                  {...control("client_ref")}
                  placeholder="Echoed back in the webhook"
                  autoComplete="off"
                  spellCheck={false}
                  className="mono"
                />
              </Field>

              {failure ? (
                <div ref={failureAlert} tabIndex={-1} role="alert">
                  <Alert tone="danger" title={failure.title}>
                    <p>{failure.message}</p>
                    {failure.other.map((problem) => (
                      <p key={problem}>{problem}</p>
                    ))}
                    {failure.canRetrySafely ? (
                      <p>
                        You can send again. The same idempotency key is reused, so the message can
                        not go out twice.
                      </p>
                    ) : null}
                  </Alert>
                </div>
              ) : null}

              <div className={styles.actions}>
                {/* Until the draft is priced and valid the button is drawn as an
                    outline; it still submits, which shows every field's error. */}
                <Button
                  ref={submitButton}
                  type="submit"
                  variant="primary"
                  className={ready ? undefined : "is-unready"}
                  disabled={unsupported}
                  aria-disabled={send.isPending || alreadySent}
                  aria-describedby={alreadySent ? "send-status" : "send-consequence"}
                >
                  {send.isPending
                    ? "Sending…"
                    : sendButtonLabel({
                        analysis,
                        text: values.text,
                        to: values.to,
                        price,
                        currency,
                      })}
                </Button>
                <Button variant="quiet" onClick={reset}>
                  Reset
                </Button>
                <p id="send-consequence" className={styles.consequence}>
                  Charged to {tenant.name} now. Refunded if it fails before the carrier.
                </p>
                {alreadySent ? (
                  <p id="send-status" className={styles.consequence}>
                    Sent. To send the same message again, clear the last send below.
                  </p>
                ) : null}
              </div>
            </form>
          )}

          {result ? (
            <ResultLine
              key={result.message.id}
              message={result.message}
              onClear={alreadySent ? clearResult : undefined}
            />
          ) : null}
        </div>

        <Preview
          headline={headline.sentence}
          text={values.text}
          to={values.to}
          analysis={analysis}
          price={price}
          prices={prices}
          tenant={tenant}
        />
      </div>
    </Section>
  );
}
