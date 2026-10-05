#!/usr/bin/env bash
# Temporary: checks which free data hosts answer from a GitHub runner.
UA='Mozilla/5.0 (compatible; TerraMarketData/1.0; +https://thougthfullcarrot.github.io/Terra/)'
probe() {
  local url="$1" grep="$2"
  echo "=================== $url"
  curl -sSL -A "$UA" -m 60 -o /tmp/body -w 'status=%{http_code} type=%{content_type} size=%{size_download}\n' "$url" || echo "curl failed"
  if [ -n "$grep" ]; then grep -oiE "$grep" /tmp/body | sort -u | head -60; else head -c 900 /tmp/body | tr -d '\000'; echo; fi
}
probe "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"
probe "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10,SOFR,MORTGAGE30US,DPRIME,DFF&cosd=2026-09-01"
probe "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DRTSCLCC"
probe "https://fred.stlouisfed.org/graph/fredgraph.csv?id=SUBLPDRCSC"
probe "https://markets.newyorkfed.org/api/rates/secured/sofr/last/2.json"
probe "https://www2.census.gov/programs-surveys/popest/datasets/" 'href="[^"]*"'
probe "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/metro/totals/" 'href="[^"]*"'
probe "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/metro/totals/" 'href="[^"]*"'
probe "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/" 'href="[^"]*"'
probe "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/metro/totals/cbsa-est2024-alldata.csv"
probe "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/totals/co-est2024-alldata.csv"
probe "https://comptroller.texas.gov/taxes/property-tax/rates/" 'href="[^"]*(xlsx|xls|csv|zip|rates/[^"]*)"'
probe "https://api.us.socrata.com/api/catalog/v1?domains=data.texas.gov&q=property%20tax%20rate&limit=15" '"(name|id)":"[^"]*"'
probe "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services?f=json" '"name":"[^"]*(Opportunity|QOZ)[^"]*"'
probe "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services?f=json" '"name":"[^"]*(Project|UTP|Plan)[^"]*"'
probe "https://www.dallascounty.org/government/county-clerk/recording/foreclosures.php" 'href="[^"]*(pdf|foreclos)[^"]*"'
probe "https://www.traviscountytx.gov/county-clerk/foreclosures" 'href="[^"]*(pdf|foreclos)[^"]*"'
probe "https://www.bexar.org/1532/Foreclosures" 'href="[^"]*(pdf|foreclos|Document)[^"]*"'
