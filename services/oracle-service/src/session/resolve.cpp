#include "session/resolve.hpp"

#include "session/connect.hpp"
#include "util/idgen.hpp"

namespace niuma::oracle::session {

ResolvedSession ResolveSession(Manager& sessions, const nlohmann::json& params) {
  ResolvedSession out;
  const std::string sid = params.value("sessionId", "");
  if (!sid.empty()) {
    auto s = sessions.Get(sid);
    if (!s) {
      out.error = "oracle: session not found: " + sid;
      return out;
    }
    out.session = std::move(s);
    out.release = [] {};
    out.ok = true;
    return out;
  }

  auto cp = ConnectParams::FromJson(params);
  if (cp.host_address.empty()) {
    out.error = "oracle: sessionId or connect params required";
    return out;
  }

  std::string err;
  auto opened = ConnectAndProbe(cp, err);
  if (!opened.conn) {
    out.error = err.empty() ? "oracle: connect failed" : err;
    return out;
  }

  auto s = std::make_shared<Session>();
  s->id = util::NextId("tmp");
  s->conn = std::move(opened.conn);
  s->ctx = SharedContext(err);
  s->params = std::move(cp);
  s->profile = std::move(opened.profile);
  out.session = s;
  out.release = [s]() { s->Close(); };
  out.ok = true;
  return out;
}

}  // namespace niuma::oracle::session
