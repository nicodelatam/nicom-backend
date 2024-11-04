const GTEL = require("./mkConnection").GTEL;
module.exports.mkCreateClient = async function (
  mikrotikHost,
  service
) {
  const conn = await GTEL(mikrotikHost)
  const mkPlan = service.offer.plan.mikrotik_name
  const comment = `${service.code} FTTH ${service.neighborhood} ${service.address} ${service.client_name} ${service.dni} ${service.city.name} ${service.offer.plan.name} ${service.wifi_ssid} ${service.wifi_password}`;
  await conn
    .connect()
    .then(() => {})
    .then(() => {
      conn
        .write("/ppp/secret/add", [
          "=name=" + service.code,
          "=password=MIKRO" + service.code,
          "=profile=" + mkPlan,
          "=service=pppoe",
          "=comment=" + comment,
        ])
        .then(() => {
          conn.close();
        })
        .catch((err) => {
          conn.close();
          console.log(err);
        });
    })
    .catch((err) => {
      conn.close();
      console.log(err);
    });
};