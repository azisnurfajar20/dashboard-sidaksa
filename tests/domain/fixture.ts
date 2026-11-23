import type { RawWorkbook, RawCell } from '../../shared/contracts';
export const headers = {
  'Data Kandidat': ['ID_Kandidat','Nama Peserta','Jenis Kelamin','Tahun Lulus','Asal Sekolah','Asal Daerah','No. Handphone','Foto','Keterangan'],
  'Data Mitra Agent': ['Id_Agent','Nama Agent','Contact Person','Negara','Alamat','Status'],
  'Data Company': ['Id_Company','Nama Company','Agent','Negara','Hotel/Kapal Pesiar','Detail Informasi','Tahun Mulai Kerja Sama','Status Kerja Sama'],
  'Proses Rekrutment': ['Tanggal Apply','ID Kandidat','Nama Kandidat','Tahun Lulus','Agent','Company','Negara','Basis Kerja','Posisi Dilamar','Tanggal Interview Agent','Interview Agent','Tanggal Interview User','Interview User','Final Result','Status Proses','Tanggal Join','Catatan','Funnel Stage'],
  'Crew List Departure': ['NO','Nama','Posisi','Agent','Company','Tanggal Berangkat','Basis Kerja','Tahun Lulus'],
  'Funnel Rekap': ['Id Kandidat','Status Proses','Stage','Agent'],
};
export function syntheticWorkbook(): RawWorkbook {
  const data: Record<string, (string|number|null|RawCell)[][]> = {
    'Data Kandidat': [['DK_001','Test Person','P','Program A','Test School','Test Region','081-PRIVATE','photo-private','private candidate notes']],
    'Data Mitra Agent': [['AG_1','Test Agent','private contact','ID','private address','Aktif']],
    'Data Company': [['CO_1','Test Company','Test Agent','ID','Hotel','private company details','2020','Aktif']],
    'Proses Rekrutment': [['Januari 2025','DK_001','Test Person','','Test Agent','Test Company','ID','Darat','Cook','','','12 Januari 2025','Lolos','Lolos','Completed','','private application notes','Berangkat']],
    'Crew List Departure': [[1,'Test Person','Cook','Test Agent','Test Company','Menunggu Jadwal','Darat',2025]],
    'Funnel Rekap': [['DK_001',{value:'Completed',formula:'=VLOOKUP(A3,Range,2,0)'},'Berangkat','Test Agent']],
  };
  return { source:'fixture', spreadsheetId:'SYNTHETIC-UNIT-ONLY', fetchedAt:'2026-11-09T00:00:00.000Z', sheets:Object.entries(data).map(([name, rows]) => ({name,rows:[{rowNumber:1,cells:headers[name as keyof typeof headers].map(value=>({value}))},...rows.map((r,i)=>({rowNumber:i+2,cells:r.map(value=>typeof value==='object' && value!==null ? value : {value})}))]})) };
}
