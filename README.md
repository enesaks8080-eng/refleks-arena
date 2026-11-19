# Refleks Arena – çevrim içi prototip

## Neler var?
- Oda oluşturma ve 6 karakterli kodla katılma
- Farklı telefonlardan aynı odaya bağlanma
- Oda sahibinin turnuvayı başlatması
- Rastgele 1'e 1 tek eleme eşleşmeleri (tek sayıda oyuncuda bir kişi ilk turu bay geçer)
- 3 saniyelik maç geri sayımı ve 5 puanlık maçlar
- 35 ince hücre, uçlarda 6'şar yeşil hücre
- Yeşil alanda hücreye dokunarak vuruş; dıştaki 2-3 hücrede güçlü vuruş/parlama
- Her başarılı vuruştan sonra topun hızlanması; hız üst sınırı

## Yerelde çalıştırma
Node.js 18 veya üstü gerekir.

```bash
npm install
npm start
```

Tarayıcıda `http://localhost:3000` açılır. Aynı Wi-Fi'daki telefonlardan test etmek için bilgisayarın yerel IP adresini kullanın (ör. `http://192.168.1.20:3000`); güvenlik duvarında 3000 portuna izin verilmelidir.

## İnternete açma
Bu proje Node.js + Socket.IO sunucusu gerektirir. Bir Node.js barındırma servisine (ör. Render, Railway veya Fly.io) bu klasörü yükleyin. Build komutu gerekmez; Start command `npm start` olmalıdır. Servis HTTPS adresi verdikten sonra o adresi tüm oyuncularla paylaşın. `PORT` ortam değişkeni otomatik kullanılır.

## Önemli notlar
Bu, çok oyunculu oynanışın ilk çevrim içi prototipidir. Sunucu oda ve turnuva durumunu yönetir. Ücretsiz barındırma servislerinde uykuya geçme, gecikme ve eşzamanlı oyuncu sınırları olabilir; “sınırsız” katılımcı pratikte sunucu kapasitesine bağlıdır. Üretim öncesinde yeniden bağlanma, maçtan ayrılma, güvenlik, gecikme telafisi ve turnuva ağacının daha kapsamlı test edilmesi önerilir.
