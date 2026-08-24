#pragma once

#include "niuma/sqllsp/types.hpp"

#include <string>
#include <vector>

namespace niuma::sqllsp {

/** 进程内目录接口；由方言 service 注入。 */
class Catalog {
 public:
  virtual ~Catalog() = default;

  virtual bool ListSchemas(const CatalogParams& params, std::vector<SchemaHit>& out, bool& truncated,
                           std::string& error) = 0;
  virtual bool ListTables(const CatalogParams& params, std::vector<TableHit>& out, bool& truncated,
                          std::string& error) = 0;
  virtual bool ListColumns(const CatalogParams& params, std::vector<ColumnHit>& out, bool& truncated,
                           std::string& error) = 0;
};

/** 可选例程目录（CALL 槽）。 */
class RoutineCatalog : public Catalog {
 public:
  virtual bool ListRoutines(const CatalogParams& params, std::vector<RoutineHit>& out, bool& truncated,
                            std::string& error) = 0;
};

}  // namespace niuma::sqllsp
