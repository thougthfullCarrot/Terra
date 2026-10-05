#!/usr/bin/env bash
# Temporary: checks which free data hosts answer from a GitHub runner.
UA='Mozilla/5.0 (compatible; TerraMarketData/1.0; +https://thougthfullcarrot.github.io/Terra/)'
pip install -q openpyxl
for kind in city county school-district total; do
  echo "=================== xlsx $kind"
  curl -sSL -A "$UA" -o /tmp/$kind.xlsx "https://comptroller.texas.gov/taxes/property-tax/docs/2025-$kind-rates-levies.xlsx"
  unzip -l /tmp/$kind.xlsx | head -20
  python3 - "$kind" <<'PY'
import sys, openpyxl, collections, re
wb = openpyxl.load_workbook(f'/tmp/{sys.argv[1]}.xlsx', read_only=True)
for ws in wb.worksheets:
    print('sheet', ws.title, ws.max_row, ws.max_column)
    types = collections.Counter()
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        cells = ['' if v is None else str(v) for v in row]
        text = ' | '.join(cells)
        if i < 8: print(i, text[:400]); continue
        code = next((c for c in cells if re.fullmatch(r'\d{3}-\d{3}-\d{2}', c)), '')
        if code: types[code[-2:]] += 1
        if sys.argv[1] == 'total':
            if code[:3] in ('101','057','220','227','015','071') and code[-2:] not in ('04','40','19','05','09','10','24','25'):
                print(i, text[:300])
        elif any(k in text.upper() for k in ['HOUSTON','DALLAS','FORT WORTH','AUSTIN','SAN ANTONIO','EL PASO','HARRIS','TRAVIS','BEXAR','TARRANT']):
            print(i, text[:400])
    print('type suffix counts', sorted(types.items()))
PY
done
echo "--- cbsa county rows"
curl -sSL -A "$UA" https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/metro/totals/cbsa-est2025-alldata.csv -o /tmp/cbsa.csv
grep -E '^(19100|26420|12420|41700|21340),' /tmp/cbsa.csv | cut -d, -f1-6
B=https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services
q() { echo "=================== $1"; curl -sSL -A "$UA" -m 90 "$1" | head -c ${2:-3000}; echo; }
q "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer/13/query?where=STATE%3D%2748%27&groupByFieldsForStatistics=COUNTY&outStatistics=%5B%7B%22statisticType%22%3A%22count%22%2C%22onStatisticField%22%3A%22OBJECTID%22%2C%22outStatisticFieldName%22%3A%22n%22%7D%5D&f=json" 6000
q "$B/TxDOT_DCIS_All_Projects/FeatureServer/0/query?where=DISTRICT_NAME%3D%27Houston%27&outFields=*&returnGeometry=false&resultRecordCount=3&orderByFields=DIST_LET_DATE%20DESC&f=json" 99999 | sed 's/.*"features"/"features"/'
q "$B/TxDOT_DCIS_All_Projects/FeatureServer/0/query?where=1%3D1&groupByFieldsForStatistics=TPP_WORK_PROGRAM&outStatistics=%5B%7B%22statisticType%22%3A%22count%22%2C%22onStatisticField%22%3A%22OBJECTID%22%2C%22outStatisticFieldName%22%3A%22n%22%7D%5D&f=json"
q "$B/TxDOT_Projects_Info/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json" 99999 | sed 's/.*"features"/"features"/'
q "$B/TxDOT_Projects_Info/FeatureServer/0/query?where=1%3D1&groupByFieldsForStatistics=PROJ_STAT&outStatistics=%5B%7B%22statisticType%22%3A%22count%22%2C%22onStatisticField%22%3A%22OBJECTID%22%2C%22outStatisticFieldName%22%3A%22n%22%7D%5D&f=json"
