#pragma once

#include "niuma/sqllsp/types.hpp"

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace niuma::sqllsp {

struct Document {
  int version = 0;
  std::string text;
  std::string suggest_database;
  std::string suggest_schema;
};

class DocumentStore {
 public:
  void Put(const std::string& uri, int version, std::string text);
  bool Get(const std::string& uri, Document& out) const;
  void Erase(const std::string& uri);
  void SetSuggestDatabase(const std::string& uri, const std::string& database,
                          const std::string& schema);

 private:
  mutable std::mutex mu_;
  std::unordered_map<std::string, Document> docs_;
};

struct Connection {
  std::string id;
  std::string session_id;
  std::string client_id;
  std::string suggest_database;
  std::string suggest_schema;
  DocumentStore docs;
};

class Manager {
 public:
  Connection* Open(const std::string& session_id, const std::string& client_id,
                   const std::string& suggest_database);
  Connection* Get(const std::string& id);
  bool Close(const std::string& id);
  bool UpdateSuggestDatabase(const std::string& id, const std::string& database,
                             const std::string& schema);
  int CloseBySession(const std::string& session_id);

 private:
  std::mutex mu_;
  std::unordered_map<std::string, std::unique_ptr<Connection>> conns_;
  std::uint64_t seq_ = 0;
};

}  // namespace niuma::sqllsp
