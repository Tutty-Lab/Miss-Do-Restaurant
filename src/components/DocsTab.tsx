import {
  DAY_WEIGHTS,
  LATE_SHIFT_RATIOS,
  WEEKDAY_LABELS_VI,
  WEEKDAY_ORDER,
  type WeekdayKey,
} from "../lib/demand";
import { SHIFT_LENGTHS } from "../lib/shifts";
import { KEINE_OBERGRENZE, PEAK_WINDOWS_BY_WEEKDAY } from "../lib/scheduler";
import { calculatePause, minutesToTime, presenceFromPaid } from "../lib/time";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900 mb-2">{title}</h2>
      <div className="text-sm text-slate-700 space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}

/** Bảng hằng số theo thứ (đọc trực tiếp từ code nên luôn khớp). */
function WeekdayTable({
  values,
  format,
  highlight,
}: {
  values: Record<WeekdayKey, number>;
  format: (v: number) => string;
  highlight: (key: WeekdayKey) => boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr>
            {WEEKDAY_ORDER.map((k) => (
              <th
                key={k}
                className={`border border-slate-200 px-3 py-1 font-medium ${
                  highlight(k) ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-600"
                }`}
              >
                {WEEKDAY_LABELS_VI[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {WEEKDAY_ORDER.map((k) => (
              <td
                key={k}
                className={`border border-slate-200 px-3 py-1 text-center font-semibold ${
                  highlight(k) ? "bg-indigo-50 text-indigo-900" : ""
                }`}
              >
                {format(values[k])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DocsTab() {
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg bg-slate-900 text-white p-4 sm:p-5">
        <h1 className="text-lg font-semibold">Tài liệu — cách xếp lịch hoạt động</h1>
        <p className="text-sm text-slate-300 mt-1">
          Các hệ số dưới đây được <span className="font-medium">cố định trong ứng dụng</span> (không
          chỉnh trong giao diện). Bảng bên dưới đọc trực tiếp từ mã nguồn nên luôn đúng với lịch thực tế.
        </p>
      </div>

      <Section title="Nguyên tắc bắt buộc (luôn đúng)">
        <ul className="list-disc pl-5 space-y-1">
          <li>Tối đa <b>9 giờ công</b> mỗi ngày cho một người.</li>
          <li>Mỗi người <b>một ca bán hàng mỗi ngày</b> (ca lau chùi buổi tối tính riêng, xem dưới).</li>
          <li>Không làm quá <b>6 ngày liên tiếp</b> (tính ca bán hàng).</li>
          <li>
            Mỗi người phải đạt <b>đúng định mức tháng</b> (Sollstunden) — không thừa, không thiếu.
          </li>
          <li>
            <b>Giờ mở cửa 9:30–20:00, thứ 2 đến thứ 7</b> (một khung liền). <b>Chủ nhật nghỉ</b> —
            trừ <b>12 chủ nhật mở cửa</b> trong năm, mở từng ngày bằng cách thêm ngoại lệ trong{" "}
            <b>Cài đặt</b>. Ngày lễ (Berlin) quán <b>đóng cửa</b>.
          </li>
          <li>
            <b>Giờ nghỉ</b>: nhân viên chính làm <b>7 hoặc 8 tiếng nghỉ 1 giờ</b>, quá 6 tiếng nghỉ
            30 phút; <b>Minijob nghỉ 30 phút</b>. Giờ nghỉ <b>cộng thêm</b> vào thời gian có mặt,
            không trừ vào giờ công.
          </li>
          <li>
            <b>Ngày làm trong tuần</b> và <b>số ngày làm mỗi tuần</b> đặt riêng cho từng
            người ở tab <b>Nhân viên</b>.
            <br />
            <span className="text-slate-500">
              Hai thứ khác nhau: hàng nút chọn <b>NHỮNG THỨ NÀO</b> được xếp; ô số nói{" "}
              <b>BAO NHIÊU</b> ngày mỗi tuần được dùng. Bỏ trống cả hai = không hạn chế.
            </span>
          </li>
          <li>
            <b>Lau chùi (Zuschlag)</b> là hai <b>quỹ giờ riêng</b>, tách khỏi định mức bán hàng,
            đặt ở tab <b>Nhân viên</b>:
            <br />
            <span className="text-slate-500">
              <b>Lau chùi buổi tối (Nachtzuschlag)</b>: sau khi đóng cửa, <b>20:00–23:00</b>, tối đa
              3h/ngày, các ngày T2–T7. <b>Lau chùi chủ nhật (Sonntagszuschlag)</b>: 10:00–20:00, tối
              đa 8h mỗi chủ nhật. Ai được đặt số giờ lau chùi thì app tự xếp thêm ca vào đúng khung
              đó. Nếu không xếp đủ thì chỉ <b>cảnh báo</b>.
            </span>
          </li>
        </ul>
      </Section>

      <Section title="1) Trọng số nhu cầu theo ngày">
        <p>
          Dùng để chia <b>tổng giờ công cả tháng</b> ra từng ngày: ngày trọng số cao được xếp nhiều giờ
          hơn. Đây là hệ số tương đối, ngày thường = 1.0.
        </p>
        <WeekdayTable
          values={DAY_WEIGHTS}
          format={(v) => v.toFixed(2).replace(".", ",")}
          highlight={(k) => DAY_WEIGHTS[k] > 1}
        />
        <p className="text-slate-600">
          Công thức mỗi ngày: <code>giờ ngày = tổng giờ tháng × trọng số ngày ÷ tổng trọng số</code>.
          <br />
          Quán báo <b>thứ 7 đông nhất, doanh thu gần gấp đôi ngày thường</b>, nên thứ 7 có
          trọng số 1,8 còn các ngày khác là 1,0. Chủ nhật quán nghỉ (chỉ 12 CN mở trong năm).
          Nếu sai thì sửa đúng một dòng này trong mã nguồn.
        </p>
      </Section>

      <Section title="2) Tỉ lệ ca tối vs ca sáng">
        <p>
          Với số giờ đã chia cho mỗi ngày, phần trăm dưới đây là <b>tỉ lệ giờ dành cho ca tối</b> (phần
          còn lại là ca sáng). Miss Do mở <b>9:30–20:00</b> liền một khung, cả tuần như nhau.
          Hai đầu ngày mạnh gần bằng nhau (trưa 11–14, chiều 16–19) nên tỉ lệ để <b>50/50</b>.
        </p>
        <WeekdayTable
          values={LATE_SHIFT_RATIOS}
          format={(v) => Math.round(v * 100) + "%"}
          highlight={(k) => LATE_SHIFT_RATIOS[k] >= 0.5}
        />
        <p className="text-slate-600">
          Giờ cao điểm <b>khác nhau theo thứ</b>:
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <tbody>
              {WEEKDAY_ORDER.filter((k) => PEAK_WINDOWS_BY_WEEKDAY[k].length > 0).map((k) => (
                <tr key={k}>
                  <td className="border border-slate-200 px-3 py-1 text-slate-600">
                    {WEEKDAY_LABELS_VI[k]}
                  </td>
                  <td className="border border-slate-200 px-3 py-1 font-medium">
                    {PEAK_WINDOWS_BY_WEEKDAY[k]
                      .map(
                        (p) =>
                          `${minutesToTime(p.startMinutes)}–${minutesToTime(p.endMinutes)}: ` +
                          // Ohne Obergrenze steht dort sonst "2–99 người".
                          (p.maxStaff >= KEINE_OBERGRENZE
                            ? `từ ${p.minStaff} người trở lên`
                            : p.minStaff === p.maxStaff
                              ? `đúng ${p.minStaff} người`
                              : `${p.minStaff}–${p.maxStaff} người`),
                      )
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-slate-600">
          Phải đủ <b>suốt cả khung</b> chứ không chỉ tại một thời điểm — không phải chỉ
          đủ ở một thời điểm nào đó rồi hụt lúc khác. <b>Không có giới hạn trên</b>: quán
          báo cuối tuần "cần nhiều nhân viên". Ngoài khung cao điểm, mở cửa và đóng cửa thì
          một người là đủ.
        </p>
        <p className="text-slate-600">
          Cách rẻ nhất để phủ một ngày <b>không phải</b> hai ca dài bằng nhau. App <b>tự dò</b> tổ
          hợp rẻ nhất theo đúng khung giờ và khung cao điểm đang đặt — thường là một ca dài lo cả
          mở cửa lẫn đóng cửa, cộng một ca ngắn hơn thả đúng vào khung cao điểm.
        </p>
        <p className="text-slate-600">
          Nếu ngày đó <b>không đủ giờ</b> để phủ, app <b>không</b> ép ca dài nữa — ép cũng vô ích và
          còn ngốn hết giờ của người sau. Ở đây <b>một người là đủ</b> để coi khung đó có người;
          cái phải giữ là <b>không vượt trần</b>. Những ngày còn lệch — thiếu người hoặc thừa
          người — đều được <b>Bảng tổng quan cảnh báo</b> kèm danh sách ngày.
        </p>
      </Section>

      <Section title="3) Độ dài ca và giờ nghỉ">
        <p>
          Ca sáng bám đầu khung, ca tối bám cuối khung — <b>khung ở đây là từng khối mở cửa</b>,
          không phải cả ngày — ở đây mỗi ngày chỉ có một khung 9:30–20:00. Ca{" "}
          <b>không bắt buộc</b> neo vào hai đầu: nếu cần phủ cao điểm, app sẽ đẩy ca vào
          giữa ngày (VD 14:00–21:00). Người mở cửa và người đóng cửa thì luôn có.
        </p>
        <p>
          Nếu một ngày mở <b>ngắn hơn</b> (VD nửa buổi), ca sẽ <b>tự co ngắn lại</b> cho vừa khung —
          kể cả nhân viên toàn thời gian vẫn đi làm ca ngắn hôm đó, và <b>định mức tháng vẫn được bù
          đủ</b> ở các ngày khác.
        </p>
        <p>
          Giờ nghỉ <b>không trừ vào giờ công</b> mà kéo dài thời gian có mặt. Quán báo{" "}
          rằng nhân viên chính làm <b>7 hoặc 8 tiếng nghỉ 1 giờ</b>, còn <b>Minijob nghỉ 30 phút</b>.
          Nên bậc cho nhân viên chính: <b>từ 7 tiếng</b> nghỉ 60 phút, <b>quá 6 tiếng</b> nghỉ 30 phút;
          Minijob tối đa 30 phút. Mức này bằng hoặc cao hơn luật Đức (§ 4 ArbZG) — cho nghỉ nhiều hơn
          thì được, ít hơn thì không. Bảng dưới đọc thẳng từ mã nguồn (theo quy tắc nhân viên chính).
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="border border-slate-200 bg-slate-50 px-3 py-1 text-left font-medium text-slate-600">
                  Giờ công
                </th>
                {SHIFT_LENGTHS.map((h) => (
                  <th
                    key={h}
                    className="border border-slate-200 bg-slate-50 px-3 py-1 font-medium text-slate-600"
                  >
                    {h}h
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-200 px-3 py-1 text-slate-600">Nghỉ</td>
                {SHIFT_LENGTHS.map((h) => (
                  <td key={h} className="border border-slate-200 px-3 py-1 text-center font-semibold">
                    {calculatePause(h * 60)}′
                  </td>
                ))}
              </tr>
              <tr>
                <td className="border border-slate-200 px-3 py-1 text-slate-600">Có mặt</td>
                {SHIFT_LENGTHS.map((h) => (
                  <td key={h} className="border border-slate-200 px-3 py-1 text-center">
                    {(presenceFromPaid(h * 60) / 60).toFixed(1).replace(".", ",")}h
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-slate-600">
          App chọn <b>ca ngắn nhất còn kịp tiến độ</b>, không phải ca dài nhất. Lý do: định mức tháng
          chia cho số ngày còn làm được ra một nhịp trung bình; ai làm dài hơn nhịp đó sẽ hết giờ
          sớm và những ngày cuối tháng quán không còn người. Ví dụ <b>55h</b> mà chia ca 9h thì hết
          sau 6 ngày, chia ca 5h thì đủ cho 11 ngày.
        </p>
        <p className="text-slate-600">
          Khoảng <b>1/10</b> số ca được rút ngắn còn 4–5 giờ cho lịch đỡ đều đều — chỉ áp dụng khi
          ngày đó không còn cần ca dài để phủ cao điểm. Ca <b>3 giờ</b> dành riêng cho nhân viên bán
          thời gian.
        </p>
      </Section>

      <Section title="4) Ngày lễ (tự phát hiện — bang Berlin)">
        <p>
          Ứng dụng tự tính <b>ngày lễ chính thức của Berlin</b> (Sonntagstr. thuộc Berlin)
          cho năm đang chọn, gồm cả lễ cố định và lễ theo Phục Sinh. Ngày lễ được xử lý{" "}
          <b>như Chủ nhật</b> (nhu cầu + khung giờ riêng). Danh sách lễ trong tháng hiện ở tab{" "}
          <b>Cài đặt</b>.
        </p>
        <p className="mt-2">
          Berlin có một ngày mà gần như cả nước Đức không có:{" "}
          <b>Internationaler Frauentag (8.3)</b> — từ 2019, ngoài Berlin chỉ
          Mecklenburg-Vorpommern có. Ngược lại Berlin <b>không</b> có{" "}
          <b>Reformationstag (31.10)</b>, không có Fronleichnam hay Allerheiligen
          (các bang Công giáo), không có Buß- und Bettag (chỉ Sachsen), và không có
          Ostersonntag/Pfingstsonntag (chỉ Brandenburg). Tổng cộng <b>10 ngày lễ</b>.
        </p>
      </Section>

      <Section title="5) Ngày đặc biệt (bạn tự đặt)">
        <p>
          Trong tab <b>Cài đặt → Ngày đặc biệt</b>, bạn có thể ghi đè một ngày cụ thể:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>Đóng cửa cả ngày</b>: hôm đó không xếp ai, giờ được dồn sang các ngày khác.
          </li>
          <li>
            <b>Giờ làm riêng</b> (VD nghỉ nửa ngày): mọi người làm ca ngắn lọt khung giờ đó.
          </li>
        </ul>
      </Section>

      <Section title="6) In lịch và khoá tháng">
        <p>
          Ở tab <b>Bảng chấm công</b> có mục <b>In lịch làm việc</b>: in <b>cả tháng</b> hoặc in{" "}
          <b>từng tuần</b>.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>Bản tuần</b> xếp giống bảng trong app: nhân viên theo dòng, 7 ngày theo cột, kèm cột
            tổng giờ mỗi người và dòng số người mỗi ngày. Đây là bản treo ở quán.
          </li>
          <li>
            <b>Bản tháng</b> xếp ngày theo dòng — 31 cột ngày không lọt khổ giấy A4 dọc. Bản này chỉ
            để xem tổng thể.
          </li>
        </ul>
        <p>
          <b>In một tuần bất kỳ sẽ khoá lịch cả tháng đó.</b> Sau khi khoá: không sửa được ca, không
          tạo lại lịch, không đổi nhân viên — nhưng vẫn in được. Mục đích là để bản giấy đang treo ở
          quán luôn khớp với dữ liệu trong hệ thống khi bị kiểm tra. In cả tháng thì không khoá gì.
        </p>
        <p className="text-slate-600">
          Cần sửa thì bấm <b>Mở khoá</b> ở ngay khung cảnh báo (tab Bảng chấm công), xác nhận một
          lần nữa. Sửa xong nhớ <b>in lại tuần đó và thay bản cũ</b>.
        </p>
      </Section>

      <Section title="Lưu ý về tờ Stundenzettel">
        <p>
          Giao diện app bằng tiếng Việt, nhưng tờ in <b>Stundenaufzeichnung</b> giữ nguyên{" "}
          <b>tiếng Đức</b> theo mẫu để nộp tại Đức. Ngày lễ/ngày đóng cửa được ghi chú trên tờ này
          (VD <i>Feiertag</i>, <i>Betriebsruhe</i>).
        </p>
      </Section>
    </div>
  );
}
