import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { PeerScope, RemoteError } from "@deepseek-ai/dsh-typert-protocol";

//#region src/remote-error-codes.d.ts
/**
 * Gateway infrastructure failure codes merged into the shared Remote failure
 * vocabulary. Face-neutral: the Host face and the Client face each import this
 * module so both programs see the same map entries.
 */
/** Wire details every Gateway infrastructure failure carries. */
interface TypertGatewayFaultDetails {
  /** Canonical `<namespace>/<method>` endpoint. */
  readonly endpoint: string;
  /** Affected wire field when the failure is field-specific. */
  readonly field?: string;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'gateway/ambiguous-endpoint': TypertGatewayFaultDetails;
    'gateway/arguments-invalid': TypertGatewayFaultDetails;
    'gateway/binding-invalid': TypertGatewayFaultDetails;
    'gateway/context-failed': TypertGatewayFaultDetails;
    'gateway/context-not-found': TypertGatewayFaultDetails;
    'gateway/context-unavailable': TypertGatewayFaultDetails;
    'gateway/definition-unavailable': TypertGatewayFaultDetails;
    'gateway/input-invalid': TypertGatewayFaultDetails;
    'gateway/invocation-unavailable': TypertGatewayFaultDetails;
    'gateway/lookup-failed': TypertGatewayFaultDetails;
    'gateway/lookup-not-found': TypertGatewayFaultDetails;
    'gateway/lookup-unavailable': TypertGatewayFaultDetails;
    'gateway/method-unavailable': TypertGatewayFaultDetails;
    'gateway/protocol': TypertGatewayFaultDetails;
    'gateway/provider-mismatch': TypertGatewayFaultDetails;
    'gateway/result-invalid': TypertGatewayFaultDetails;
    'gateway/service-unavailable': TypertGatewayFaultDetails;
    'gateway/signature-invalid': TypertGatewayFaultDetails;
    'gateway/uplink-overflow': TypertGatewayFaultDetails;
  }
} //# sourceMappingURL=remote-error-codes.d.ts.map
//#endregion
//#region src/stream-protocol.d.ts
/** Stable Host facts published with every established Client event generation. */
interface RemoteEventHostInfo {
  /** Host account home used only to abbreviate displayed filesystem paths. */
  readonly home: string;
}
//#endregion
//#region src/types.d.ts
/** One Remote method request after a carrier has decoded its envelope. */
interface InvokeRemoteRequest {
  /** Remote namespace selected by the generated descriptor. */
  readonly namespace: string;
  /** Exported Service method name. */
  readonly method: string;
  /** Named wire values; fields must exactly match the descriptor. */
  readonly args: Readonly<Record<string, unknown>>;
  /**
   * Client uplink items of this logical stream, delivered to the method through
   * `invocation.uplink()`; absent means an immediately ended iterable.
   */
  readonly uplink?: AsyncIterable<unknown>;
  /** Peer the call speaks for; absent means an in-process carrier, answered as the operator. */
  readonly peer?: PeerScope;
  /** Carrier or direct-caller cancellation injected only into cancellation-aware methods. */
  readonly signal?: AbortSignal;
}
/** One Host Cordis notification forwarded unchanged to Client Remote subscribers. */
interface TypertRemoteEventFrame {
  /** Original Host Cordis event name. */
  readonly event: string;
  /** Original event argument list after the owner validates it for JSON transport. */
  readonly args: readonly unknown[];
}
/** Live Host values used to project one scoped Remote Event. */
interface TypertRemoteEventContext {
  /** Live Agent Context that owns cancellation of the forwarded waterfall. */
  readonly value: Context;
  /** Agent object carried directly by the waterfall request. */
  readonly subject: object;
  /** Agent identity read directly from the scoped event subject. */
  readonly agentId: string;
}
/** Result returned from a Client waterfall, or delegation back to the Host chain. */
type TypertRemoteEventOutcome = {
  readonly kind: 'result';
  readonly value: unknown;
} | {
  readonly kind: 'next';
};
/**
 * One scoped waterfall invocation yielded by the application event source.
 * The Gateway alone assigns transport ids and resolves the continuation after
 * a Client result or explicit delegation.
 */
interface TypertRemoteEventInvocation {
  /** Original Host Cordis event name. */
  readonly event: string;
  /** Sole request argument before the waterfall's `next()` callback. */
  readonly request: object;
  readonly context: TypertRemoteEventContext;
  /** Resume the source's Cordis listener with a Client result or `next()`. */
  readonly resolve: (outcome: TypertRemoteEventOutcome) => void;
  /** Reject the source's Cordis listener after cancellation, transport failure, or Client rejection. */
  readonly reject: (reason: unknown) => void;
}
/** Notification or scoped waterfall accepted from the sole Remote Event source. */
type TypertRemoteEventDispatch = TypertRemoteEventFrame | TypertRemoteEventInvocation;
/**
 * Open the application-selected event stream for one Client carrier. The
 * factory must attach all incremental Host listeners before it returns; the
 * Gateway publishes its readiness item immediately afterward.
 * @param signal - cancellation shared with the Client stream and registration.
 * @returns the long-lived stream of notifications and scoped waterfall invocations.
 */
type TypertRemoteEventSource = (signal: AbortSignal) => AsyncIterable<TypertRemoteEventDispatch>;
/** Carrier-facing access to decoded Remote streams and their stable failures. */
interface TypertGatewayWireStream {
  /**
   * Open one logical stream from its wire endpoint and payload.
   * @param endpoint - canonical Remote endpoint or Gateway-owned stream name.
   * @param payload - decoded carrier payload.
   * @param uplink - Client-to-Host items of the logical stream; a Gateway-owned endpoint returns its iterator
   * as soon as it opens, so the carrier drops those items instead of buffering them.
   * @param peer - Peer the stream speaks for; `undefined` means the operator's in-process carrier.
   * @param signal - logical-stream cancellation.
   * @returns validated stream values.
   */
  readonly open: (endpoint: string, payload: unknown, uplink: AsyncIterable<unknown>, peer: PeerScope | undefined, signal: AbortSignal) => Promise<AsyncIterable<unknown>>;
  /**
   * Convert a stream failure to the carrier-safe Remote failure fields.
   * @param error - failure raised while opening or consuming a stream.
   * @returns stable code, message, and details for the Client.
   */
  readonly failure: (error: unknown) => {
    readonly code: string;
    readonly message: string;
    readonly details: object;
  };
}
/** Stable infrastructure and boundary failures emitted before or after business execution. */
type TypertGatewayErrorCode = 'gateway/ambiguous-endpoint' | 'gateway/arguments-invalid' | 'gateway/binding-invalid' | 'gateway/context-failed' | 'gateway/context-not-found' | 'gateway/context-unavailable' | 'gateway/definition-unavailable' | 'gateway/input-invalid' | 'gateway/invocation-unavailable' | 'gateway/lookup-failed' | 'gateway/lookup-not-found' | 'gateway/lookup-unavailable' | 'gateway/method-unavailable' | 'gateway/protocol' | 'gateway/provider-mismatch' | 'gateway/result-invalid' | 'gateway/service-unavailable' | 'gateway/signature-invalid' | 'gateway/uplink-overflow';
/** Host dispatcher consumed by Connection adapters. */
interface TypertGateway {
  /** Carrier adapter shared by WebSocket and in-process transports. */
  readonly wireStream: TypertGatewayWireStream;
  /**
   * Register the application-selected forwarded-event source.
   * @param source - stream factory installed by the Remote assembly.
   * @param host - stable Host facts included in each Client generation's opening frame.
   * @returns disposer removing this exact source and cancelling its active streams.
   */
  registerRemoteEvents(source: TypertRemoteEventSource, host: RemoteEventHostInfo): () => Promise<void>;
  /**
   * Invoke one live Remote method without assuming a carrier or response envelope.
   * @param request - decoded endpoint and named wire arguments.
   * @returns the business result without output decoding.
   * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
   */
  invoke(request: InvokeRemoteRequest): Promise<unknown>;
  /**
   * Open one live stream Remote method without assuming a physical carrier.
   * @param request - decoded endpoint, named wire arguments, and the Client uplink when the carrier has one.
   * @returns a cancellation-aware iterable over the business results.
   */
  stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host dispatcher for Typert Remote calls. */
    typertGateway: TypertGateway;
  }
} //# sourceMappingURL=types.d.ts.map
//#endregion
//#region src/index.d.ts
interface GatewayErrorOptions {
  readonly cause?: unknown;
  readonly field?: string;
}
/** Gateway transport configuration. */
interface Config {
  /** WebSocket Ping interval from 1 through 2,147,483,647 milliseconds. @default 2000 */
  readonly websocketHeartbeatIntervalMs?: number;
  /** Buffered uplink frame bytes one logical stream may hold before it fails with `gateway/uplink-overflow`. @default 262144 */
  readonly streamInboxBytes?: number;
}
/**
 * Dispatch failure produced outside the invoked business method. Rides the
 * shared Remote failure vocabulary, so its code crosses the wire instead of
 * folding to `internal`.
 */
declare class TypertGatewayError extends RemoteError<TypertGatewayErrorCode> {
  /** Canonical `<namespace>/<method>` endpoint. */
  readonly endpoint: string;
  /** Affected wire field when the failure is field-specific. */
  readonly field: string | undefined;
  /**
   * Construct a Gateway failure without embedding boundary values in its message.
   * @param code - stable failure category.
   * @param endpoint - canonical Remote endpoint.
   * @param message - correction-oriented diagnostic without sensitive values.
   * @param options - optional field and contained cause.
   */
  constructor(code: TypertGatewayErrorCode, endpoint: string, message: string, options?: GatewayErrorOptions);
}
/**
 * Resolve strict generated definitions or conservative SRC markers against
 * current Cordis Services and Typert providers.
 * @typert service typertGateway
 */
declare class TypertGatewayService extends Service implements TypertGateway {
  static inject: string[];
  static Config: z<Config>;
  /** Carrier adapter shared by the WebSocket mux and local Host transports. */
  readonly wireStream: TypertGatewayWireStream;
  private srcClaims;
  private inProcessOperator;
  private remoteEvents;
  private readonly remoteEventClients;
  private readonly pendingRemoteEvents;
  /**
   * Register the Gateway against the active Typert registry.
   * WebSocket admission waits for launcher-owned application readiness when supplied;
   * direct invocation and in-process streams remain available independently.
   * @param ctx - owning Host Context with Typert registry access.
   * @param config - validated Gateway transport configuration.
   */
  constructor(ctx: Context, config: Config);
  /**
   * Register the sole application-selected forwarded-event source.
   * @param source - stream factory installed by the Remote assembly.
   * @param host - stable Host facts included in each Client generation's opening frame.
   * @returns disposer removing this source and cancelling its active streams.
   */
  registerRemoteEvents(source: TypertRemoteEventSource, host: RemoteEventHostInfo): () => Promise<void>;
  private claimsEndpoint;
  private collectSrcClaims;
  /**
   * Invoke one live Remote method through strict generated reflection or SRC markers.
   * @param request - decoded endpoint and exact named wire arguments.
   * @returns the business result without output decoding.
   * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
   */
  invoke(request: InvokeRemoteRequest): Promise<unknown>;
  private invokePrepared;
  /**
   * Open one live stream Remote method without assuming a physical carrier.
   * @param request - decoded endpoint, named wire arguments, and the Client uplink when the carrier has one.
   * @returns a cancellation-aware iterable over the business results.
   */
  stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>;
  /**
   * `control` belongs to the logical stream: a rejected uplink item aborts it
   * with the Remote failure as the reason so the carrier delivers that failure.
   */
  private openStream;
  private dispatchRpc;
  private openWireStream;
  /**
   * The Peer an in-process carrier speaks for when it names none: the
   * operator's Peer when Connection is mounted, otherwise an operator scope the
   * Gateway owns for its own lifetime.
   * @returns the operator Peer.
   */
  private operatorPeer;
  private openRemoteEvents;
  private consumeRemoteEvents;
  private broadcastRemoteEvent;
  private startRemoteEvent;
  private deliverRemoteEvent;
  private receiveRemoteEventResult;
  private removeRemoteEventDelivery;
  private removeRemoteEventClient;
  private settleRemoteEvent;
  private cancelRemoteEvent;
  private finishRemoteEvent;
  private closeRemoteEvents;
  private invokeRpc;
  /** `control` fails the logical stream when an uplink item is rejected; unary calls hand over an inert one. */
  private prepareInvocation;
  private resolveDescriptor;
  private resolveSrcDescriptor;
  private srcDescriptor;
  private resolveReceiverContext;
  private resolveParameter;
}
//#endregion
export { Config, type InvokeRemoteRequest, type RemoteEventHostInfo, type TypertGateway, TypertGatewayError, type TypertGatewayErrorCode, type TypertGatewayFaultDetails, TypertGatewayService, TypertGatewayService as default, type TypertGatewayWireStream, type TypertRemoteEventContext, type TypertRemoteEventDispatch, type TypertRemoteEventFrame, type TypertRemoteEventInvocation, type TypertRemoteEventOutcome, type TypertRemoteEventSource };