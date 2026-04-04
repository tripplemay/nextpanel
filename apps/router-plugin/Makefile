# OpenWrt package Makefile for luci-app-nextpanel
# For building inside the OpenWrt buildroot:
#   1. Place this directory under package/feeds/luci/luci-app-nextpanel/
#   2. Run: make package/luci-app-nextpanel/compile
#
# For standalone .ipk builds, use the GitHub Actions workflow instead.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-nextpanel
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=NextPanel

LUCI_TITLE:=NextPanel HomeProxy Sync
LUCI_DESCRIPTION:=Automatically syncs proxy configuration from the NextPanel panel to HomeProxy on OpenWrt routers. Includes complete routing rules for ads, AI services, streaming, and China bypass.
LUCI_DEPENDS:=+luci-base +curl

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=$(LUCI_TITLE)
  DEPENDS:=$(LUCI_DEPENDS)
  PKGARCH:=all
endef

define Package/$(PKG_NAME)/description
  $(LUCI_DESCRIPTION)
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/nextpanel-sync $(1)/etc/init.d/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DATA) ./root/etc/config/nextpanel $(1)/etc/config/

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-nextpanel.json $(1)/usr/share/luci/menu.d/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-nextpanel.json $(1)/usr/share/rpcd/acl.d/

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/nextpanel
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/nextpanel/config.js \
	                $(1)/www/luci-static/resources/view/nextpanel/
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
  chmod +x /etc/init.d/nextpanel-sync
  /etc/init.d/nextpanel-sync enable 2>/dev/null || true
  /etc/init.d/rpcd reload 2>/dev/null || true
  echo "NextPanel installed. Visit LuCI → Services → NextPanel to configure."
}
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
  /etc/init.d/nextpanel-sync stop 2>/dev/null || true
  /etc/init.d/nextpanel-sync disable 2>/dev/null || true
}
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
