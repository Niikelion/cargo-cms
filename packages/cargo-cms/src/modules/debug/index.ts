import {makeModule} from "@cargo-cms/modules-core";
import {JSONValue} from "@cargo-cms/utils";

const handlers: Record<string, {
    enabled: boolean
}> = {}

type LogMessage = JSONValue | (() => JSONValue)

const data = {
    setChannelEnabled(channel: string, enabled: boolean) {
        handlers[channel] ??= {enabled}
        handlers[channel].enabled = enabled
    },
    log(msg: LogMessage , channel?: string) {
        if (channel && channel in handlers) {
            //if channel is disabled, stop
            if (!handlers[channel].enabled)
                return
        }

        if (msg instanceof Function)
            msg = msg()

        console.dir(msg, {depth: 10})
    },
    channel(channel: string) {
        return {
            log(msg: LogMessage) { data.log(msg, channel) }
        }
    }
}

const debugModule = makeModule("debug", {}, data)

export type DebugModule = typeof debugModule
export default debugModule