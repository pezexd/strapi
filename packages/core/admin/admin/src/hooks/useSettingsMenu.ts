import * as React from 'react';

import { hasPermissions, useRBACProvider, useStrapiApp, useAppInfo } from '@strapi/helper-plugin';
import sortBy from 'lodash/sortBy';
import { useSelector } from 'react-redux';

import { SETTINGS_LINKS_CE } from '../constants';
// @ts-expect-error not converted yet
import { selectAdminPermissions } from '../selectors';

import { useEnterprise } from './useEnterprise';

interface TLink {
  intlLabel: { id: string; defaultMessage: string };
  to: string;
  id: string;
  lockIcon?: boolean;
  permissions?: unknown[];
}

interface TMenu {
  global: TLink[];
  admin: TLink[];
}

interface TMenuSection {
  id: string;
  intlLabel: { id: string; defaultMessage: string };
  links: TMenuSectionLink[];
}

interface TMenuSectionLink extends TLink {
  hasNotification: boolean;
  isDisplayed: boolean;
}

const formatLinks = (menu: TMenuSection[]) => {
  return menu.map((menuSection) => {
    const formattedLinks = menuSection.links.map((link) => ({
      ...link,
      isDisplayed: false,
    }));

    return { ...menuSection, links: formattedLinks };
  });
};

const sortLinks = (links: TLink[]) => sortBy(links, (link) => link.id);

export const useSettingsMenu = () => {
  const [{ isLoading, menu }, setData] = React.useState<{
    isLoading: boolean;
    menu: TMenuSection[];
  }>({
    isLoading: true,
    menu: [],
  });
  const { allPermissions: userPermissions } = useRBACProvider();
  const { shouldUpdateStrapi } = useAppInfo();
  const { settings } = useStrapiApp();
  const permissions = useSelector(selectAdminPermissions);

  const { global: globalLinks, admin: adminLinks } = useEnterprise<TMenu, TMenu, TMenu>(
    SETTINGS_LINKS_CE,
    async () => (await import('../../../ee/admin/constants')).SETTINGS_LINKS_EE,
    {
      combine(ceLinks, eeLinks) {
        return {
          admin: [...eeLinks.admin, ...ceLinks.admin],
          global: [...ceLinks.global, ...eeLinks.global],
        };
      },
      defaultValue: {
        admin: [],
        global: [],
      },
    }
  );

  const addPermissions = React.useCallback(
    (link: TLink) => ({
      ...link,
      permissions: permissions.settings?.[link.id]?.main,
    }),
    [permissions.settings]
  );

  React.useEffect(() => {
    const getData = async () => {
      const buildMenuPermissions = (sections: TMenuSection[]) =>
        Promise.all(
          sections.reduce((acc, section, sectionIndex) => {
            const buildMenuPermissions = (links: TMenuSectionLink[]) =>
              links.map(async (link, linkIndex) => ({
                hasPermission: await hasPermissions(userPermissions, link.permissions),
                sectionIndex,
                linkIndex,
              }));

            return [...acc, ...buildMenuPermissions(section.links)];
          }, [])
        );

      const menuPermissions = await buildMenuPermissions(sections);

      setData((prev) => ({
        ...prev,
        isLoading: false,
        menu: sections.map((section, sectionIndex) => ({
          ...section,
          links: section.links.map((link, linkIndex) => {
            const permission = menuPermissions.find(
              (permission) =>
                permission.sectionIndex === sectionIndex && permission.linkIndex === linkIndex
            );

            return {
              ...link,
              isDisplayed: Boolean(permission.hasPermission),
            };
          }),
        })),
      }));
    };

    const { global, ...otherSections } = settings;

    const sections = formatLinks([
      {
        ...settings.global,
        links: sortLinks([...settings.global.links, ...globalLinks.map(addPermissions)]).map(
          (link) => ({
            ...link,
            hasNotification: link.id === '000-application-infos' && shouldUpdateStrapi,
          })
        ),
      },
      {
        id: 'permissions',
        intlLabel: { id: 'Settings.permissions', defaultMessage: 'Administration Panel' },
        links: adminLinks.map(addPermissions),
      },
      ...Object.values(otherSections),
    ]);

    getData();
  }, [adminLinks, globalLinks, userPermissions, settings, shouldUpdateStrapi, addPermissions]);

  return {
    isLoading,
    menu: menu.map((menuItem) => {
      return {
        ...menuItem,
        links: menuItem.links.filter((link) => link.isDisplayed),
      };
    }),
  };
};
