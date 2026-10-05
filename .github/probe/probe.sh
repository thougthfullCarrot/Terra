#!/usr/bin/env bash
# Temporary: checks which free data hosts answer from a GitHub runner.
UA='Mozilla/5.0 (compatible; TerraMarketData/1.0; +https://thougthfullcarrot.github.io/Terra/)'
pip install -q openpyxl
probe() {
  echo "=================== $1"
  curl -sSL -A "$UA" -m 90 -o /tmp/body -w 'status=%{http_code} type=%{content_type} size=%{size_download}\n' "$1" || echo "curl failed"
  head -c ${2:-1500} /tmp/body | tr -d '\000'; echo
}
probe "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10" 200
echo "--- cbsa 2025 TX"
curl -sSL -A "$UA" https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/metro/totals/cbsa-est2025-alldata.csv -o /tmp/cbsa.csv
head -1 /tmp/cbsa.csv; grep -E '^(19100|26420|12420|41700|21340),' /tmp/cbsa.csv | cut -c1-400
file /tmp/cbsa.csv
echo "--- county 2025 TX sample"
curl -sSL -A "$UA" https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv -o /tmp/co.csv
head -1 /tmp/co.csv | cut -c1-300; grep -E '^0?50,3,7,48,(000|201|113),' /tmp/co.csv | cut -c1-300; grep -c ',48,' /tmp/co.csv
for kind in city county school-district special-district total; do
  echo "=================== xlsx $kind"
  curl -sSL -A "$UA" -o /tmp/$kind.xlsx -w 'status=%{http_code} size=%{size_download}\n' "https://comptroller.texas.gov/taxes/property-tax/docs/2025-$kind-rates-levies.xlsx"
  python3 - "$kind" <<'PY'
import sys, openpyxl
wb = openpyxl.load_workbook(f'/tmp/{sys.argv[1]}.xlsx', read_only=True)
for ws in wb.worksheets:
    print('sheet', ws.title, ws.max_row, ws.max_column)
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        text = ' | '.join('' if v is None else str(v) for v in row)
        if i < 6 or any(k in text.upper() for k in ['HOUSTON', 'DALLAS', 'FORT WORTH', 'AUSTIN', 'SAN ANTONIO', 'EL PASO', 'HARRIS', 'TRAVIS', 'BEXAR', 'TARRANT']):
            print(i, text[:300])
        if i > 20000: break
PY
done
probe "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer?f=json" 1500
probe "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer/13/query?where=STATE%3D%2748%27&outFields=*&returnGeometry=false&resultRecordCount=2&f=json" 2500
probe "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json" 2500
for svc in TxDOT_Projects_Info Planned_Programmed_Projects_1 TxDOT_DCIS_All_Projects ProjectTracker_AGO; do
  probe "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/$svc/FeatureServer?f=json" 800
  probe "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/$svc/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json" 4000
  probe "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/$svc/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json" 200
done
