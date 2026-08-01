#pragma once

#include <string>
#include <string_view>

namespace niuma::serviceipc {

/** Platform 事件入口地址（与 Go packages/go/serviceipc/event 对齐）。 */
std::string EventIngestAddress();

/**
 * 向 Platform 事件入口写一帧 length-prefixed JSON（短连接）。
 * 失败返回 false（进度事件失败可忽略，避免拖垮 IO）。
 */
bool PublishEvent(std::string_view json_payload);

}  // namespace niuma::serviceipc
