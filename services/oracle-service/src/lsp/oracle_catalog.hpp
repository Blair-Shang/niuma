#pragma once

#include "niuma/sqllsp/catalog.hpp"
#include "session/manager.hpp"

namespace niuma::oracle::lsp {

/** 进程内复用 catalog::List* / tree 例程列表。 */
class OracleCatalog final : public niuma::sqllsp::RoutineCatalog {
 public:
  explicit OracleCatalog(session::Manager& sessions) : sessions_(sessions) {}

  bool ListSchemas(const niuma::sqllsp::CatalogParams& params,
                   std::vector<niuma::sqllsp::SchemaHit>& out, bool& truncated,
                   std::string& error) override;
  bool ListTables(const niuma::sqllsp::CatalogParams& params,
                  std::vector<niuma::sqllsp::TableHit>& out, bool& truncated,
                  std::string& error) override;
  bool ListColumns(const niuma::sqllsp::CatalogParams& params,
                   std::vector<niuma::sqllsp::ColumnHit>& out, bool& truncated,
                   std::string& error) override;
  bool ListRoutines(const niuma::sqllsp::CatalogParams& params,
                    std::vector<niuma::sqllsp::RoutineHit>& out, bool& truncated,
                    std::string& error) override;

 private:
  session::Manager& sessions_;
};

}  // namespace niuma::oracle::lsp
